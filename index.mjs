import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, watch } from "node:fs";


// SillyTavern
import { jsonParser } from "../../src/express-common.js";
import { delay, uuidv4 } from "../../src/util.js";
import { getAllUserHandles, getUserDirectories } from "../../src/users.js";

// Plugin
import { readFirstLine } from "./src/readFirstLine.mjs";
import { hashFile } from "./src/hashFile.mjs";
import { log, warn, error } from "./src/console.mjs";
import { buildQuery, getDb, setup } from "./src/database.mjs";
import { getVersion, setVersion, DB_VERSION } from "./src/version.mjs";
import { writeResults, writeStatus } from "./src/response.mjs";




const indexToken = {};
const indexPromise = {};
const searchToken = {};

/**@type {{user:string, char:string?, chat:string}[]} */
const reindexQueue = [];


let isProcessingReindexQueue = false;
const processReindexQueue = async()=>{
	if (isProcessingReindexQueue) return;
	if (!reindexQueue.length) return;
	isProcessingReindexQueue = true;
	await delay(1000);
	const done = [];
	const queue = [];
	while (reindexQueue.length) {
		const item = reindexQueue.shift();
		if (!item) continue;
		const key = `${item.user}/${item.char ?? ''}/${item.chat}`;
		if (done.includes(key)) continue;
		done.push(key);
		queue.push(item);
	}
	let groups = [];
	while (queue.length) {
		const item = queue.shift();
		if (!item) continue;
		log(item);
		const dirs = await getUserDirectories(item.user);
		const { db } = getDb(dirs.user);
		const isChar = (item.char?.length ?? 0) > 0;
		const chat = item.chat;
		const char = item.char;
		const chatFile = path.resolve(isChar
			? path.join(dirs.chats, String(item.char), item.chat)
			: path.join(dirs.groupChats, item.chat)
		);
		db.prepare('DELETE FROM chat WHERE absolute_path = ?').run(chatFile);
		if (!existsSync(chatFile)) {
			log('remove from index:', chatFile);
			return;
		}
		let group = null;
		let groupData = null;
		if (!isChar) {
			if (!groups.length) {
				for (const g of readdirSync(dirs.groups)) {
					const data = JSON.parse(readFileSync(path.join(dirs.groups, g), { encoding:'utf-8' }));
					groups.push(data);
				}
			}
			groupData = groups.find(it=>it.chats.includes(chat));
			if (!groupData) continue;
			group = `${groupData.id}.json`;
		}
		const meta = isChar
			? JSON.parse(await readFirstLine(chatFile))
			: groupData.past_metadata[chat]
		;
		const metaHash = isChar
			? meta.chat_meta_hash ?? `${char}/${chat}`
			: groupData.past_metadata[chat];
		;
		const modified = lstatSync(chatFile).mtimeMs;
		const fileHash = hashFile(chatFile);
		const user = item.user;
		const token = uuidv4();
		indexToken[user] = uuidv4();
		if (isChar) log('reindex:', char, chat);
		else log('reindex:', group, groupData.name, chat);
		indexFile({
			char,
			chat,
			chatFile,
			db,
			fileHash,
			group,
			metaHash,
			modified,
			token,
			user,
		});
	}
	isProcessingReindexQueue = false;
	processReindexQueue();
};


const indexFile = async({
	db,
	chatFile,
	metaHash,
	chat,
	modified,
	fileHash,
	char,
	group,
	user,
	token,
})=>{
	const lines = readFileSync(chatFile, { encoding:'utf-8' })
		.split('\n')
		.map((line,idx)=>{
			try { return JSON.parse(line); } catch {}
		})
		.filter(it=>it)
	;
	if (char) lines.shift();
	const stmt = db.prepare(`
		INSERT INTO chat (
			meta_hash,
			filename,
			modified_on,
			file_hash,
			character_id,
			group_id,
			absolute_path
		)
		VALUES (
			?,
			?,
			?,
			?,
			?,
			?,
			?
		)
	`);
	const chatId = stmt.run(
		metaHash,
		chat,
		modified,
		fileHash,
		char,
		group,
		chatFile,
	).lastInsertRowid;
	for (const [idx, mes] of Object.entries(lines)) {
		const stmt = db.prepare(`
			INSERT INTO message (
				chat_id,
				message_index,
				swipe_index,
				name,
				is_user,
				is_system
			)
			VALUES (
				?,
				?,
				?,
				?,
				?,
				?
			)
		`);
		const mesId = stmt.run(
			chatId,
			idx,
			mes.swipe_id ?? 0,
			mes.name ?? '',
			mes.is_user ? 1 : 0,
			mes.is_system ? 1 : 0,
		).lastInsertRowid;
		for (const [idx, swipe] of Object.entries(mes.swipes ?? [mes.mes])) {
			if (!swipe?.length) continue;
			const stmt = db.prepare(`
				INSERT INTO swipe (
					message_id,
					swipe_index,
					content,
					send_date
				)
				VALUES (
					?,
					?,
					?,
					?
				)
			`);
			stmt.run(
    mesId,
    idx,
    swipe,
    (mes.swipe_info?.[idx]?.send_date ?? mes.send_date ?? null)
);

		}
	}
};


/**
 * @param {DatabaseSync} db
 * @param {string} user
 * @param {import("../../src/users.js").UserDirectoryList} dirs
 * @param {import("express").Response?} res
 */
const indexFiles = async(db, user, dirs, res = null)=>{
	log('indexFiles', user);
	const waitStart = performance.now();
	const token = uuidv4();
	indexToken[user] = token;
	const { promise, resolve } = Promise.withResolvers();
	await indexPromise[user];
	if (indexToken[user] != token) return;
	indexPromise[user] = promise;
	log('waited:', performance.now() - waitStart);

	const startTime = performance.now();
	let cacheCount = 0;
	let indexCount = 0;
	let reindexCount = 0;
	let lastProgress = Number.MIN_SAFE_INTEGER;
	let found = false;

	{ // char chats
		log('indexing character chats');
		const chars = readdirSync(dirs.characters)
			.filter(it=>it.endsWith('png'))
			.map(it=>it.slice(0, -4))
		;
		for (const [charIdx, char] of Object.entries(chars)) {
			if (indexToken[user] != token) break;
			log(char);
			const chatsDir = path.join(dirs.chats, char);
			if (!existsSync(chatsDir)) continue;
			const chats = readdirSync(chatsDir);
			for (const [chatIdx, chat] of Object.entries(chats)) {
				if (indexToken[user] != token) break;
				const now = performance.now();
				if (found && now - lastProgress > 200) {
					lastProgress = now;
					writeStatus(res, 'indexing chat files', [
						{
							max: chars.length,
							current: parseInt(charIdx),
							text: char,
						},
						{
							max: chats.length,
							current: parseInt(chatIdx),
							text: chat,
						},
					]);
				}
				const chatFile = path.resolve(path.join(chatsDir, chat));
				const meta = JSON.parse(await readFirstLine(chatFile));
				const metaHash = meta.chat_hash_id ?? `${char}/${chat}`;
				const modified = lstatSync(chatFile).mtimeMs;
				let cache = /**@type {import("./src/database.mjs").chatRow}*/(db.prepare('SELECT * FROM chat WHERE meta_hash = ?').get(metaHash));
				if (!cache) cache = /**@type {import("./src/database.mjs").chatRow}*/(db.prepare('SELECT * FROM chat WHERE absolute_path = ?').get(chatFile));
				if (!cache || cache.modified_on != modified) {
					found = true;
					const fileHash = hashFile(chatFile);
					if (cache && cache.file_hash != fileHash) {
						db.prepare('DELETE FROM chat WHERE id = ?').run(cache.id);
						log('reindex:', char, chat);
						reindexCount++;
					} else {
						log('index:', char, chat);
					}
					indexCount++;
					indexFile({
						char,
						chat,
						chatFile,
						db,
						fileHash,
						group: null,
						metaHash,
						modified,
						token,
						user,
					});
				} else {
					cacheCount++;
				}
			}
		}
	}
	{ // group chats
		log('indexing group chats');
		const groupDir = path.join(dirs.groups);
		const chatDir = path.join(dirs.groupChats);
		const groups = readdirSync(groupDir);
		for (const [groupIdx, group] of Object.entries(groups)) {
			if (indexToken[user] != token) break;
			const groupData = JSON.parse(readFileSync(path.join(groupDir, group), { encoding:'utf-8' }));
			log(group, groupData.name);
			for (const [chatIdx, chat] of Object.entries(groupData.chats)) {
				if (indexToken[user] != token) break;
				const now = performance.now();
				if (found && now - lastProgress > 200) {
					lastProgress = now;
					writeStatus(res, 'indexing group chat files', [
						{
							max: groups.length,
							current: parseInt(groupIdx),
							text: groupData.name,
						},
						{
							max: groupData.chats.length,
							current: parseInt(chatIdx),
							text: chat,
						},
					]);
				}
				const chatFile = path.resolve(path.join(chatDir, `${chat}.jsonl`));
				if (!existsSync(chatFile)) continue;
				const meta = groupData.past_metadata[chat];
				const metaHash = meta?.chat_hash_id ?? `${group}/${chat}`;
				const modified = lstatSync(chatFile).mtimeMs;
				let cache = /**@type {import("./src/database.mjs").chatRow}*/(db.prepare('SELECT * FROM chat WHERE meta_hash = ?').get(metaHash));
				if (!cache) cache = /**@type {import("./src/database.mjs").chatRow}*/(db.prepare('SELECT * FROM chat WHERE absolute_path = ?').get(chatFile));
				if (!cache || cache.modified_on != modified) {
					found = true;
					const fileHash = hashFile(chatFile)
					if (cache && cache.file_hash != fileHash) {
						db.prepare('DELETE FROM chat WHERE id = ?;').run(cache.id);
						log('reindex:', groupData.name, chat);
						reindexCount++;
					} else {
						log('index:', groupData.name, chat);
					}
					indexCount++;
					indexFile({
						char: null,
						chatFile,
						chat,
						db,
						fileHash,
						group,
						metaHash,
						modified,
						token,
						user,
					});
				} else {
					cacheCount++;
				}
			}
		}
	}

	const endTime = performance.now();
	log('cache:', cacheCount);
	log('reindex:', reindexCount);
	log('index:', indexCount - reindexCount);
	log('index duration:', endTime - startTime);
	resolve();
};

/**
 * @param {DatabaseSync} db
 * @param {string} query
 */
const search = async(db, user, dirs, query, options, res)=>{
	log('search', user, query, options);
	const token = uuidv4();
	searchToken[user] = token;
	const startTime = performance.now();
	if (searchToken[user] != token) return null;
	const sqlQuery = `%${query}%`;
	let count = /**@type {import("./src/database.mjs").countRow}*/(db.prepare(buildQuery({
		count: true,
		bot: options.bot,
		user: options.user,
		hidden: options.hidden,
		swipes: options.swipes,
	})).get(sqlQuery)).results;
	const matches = /**@type {import("./src/database.mjs").resultRow[]}*/(db.prepare(buildQuery({
		bot: options.bot,
		user: options.user,
		hidden: options.hidden,
		swipes: options.swipes,
		limit: true,
	})).all(sqlQuery, options.limit));
	if (searchToken[user] != token) return null;
	let removeCount = 0;
	const checked = [];
	const missing = [];
	for (let i = matches.length - 1; i >= 0; i--) {
		const row = matches[i];
		if (searchToken[user] != token) return null;
		const filePath = !row.character_id?.length
			? path.join(dirs.groupChats, `${row.filename}.jsonl`)
			: path.join(dirs.chats, row.character_id, row.filename)
		;
		if (checked.includes(filePath)) {
			if (missing[filePath]) continue;
		} else {
			checked.push(filePath);
			if (existsSync(filePath)) {
				missing[filePath] = true;
				continue;
			}
		}
		missing[filePath] = false;
		log('remove from index:', filePath);
		removeCount++;
		count--;
		db.prepare('DELETE FROM chat WHERE id = ?').run(row.chat_id);
		matches.splice(i, 1);
	}
	if (removeCount > 0) {
		log('cleanup:', removeCount);
	}
	log('search results:', count);
	const endTime = performance.now();
	log('search duration:', endTime - startTime);
	return { count, matches };
};

const initIndex = async()=>{
	log('initIndex');
	const handles = await getAllUserHandles();
	for (const handle of handles) {
		log(handle);
		const dirs = await getUserDirectories(handle);
		const { dbExists, db } = getDb(dirs.user);
		if (!dbExists || getVersion(dirs.user) != DB_VERSION) {
			log(`create database v${DB_VERSION}`);
			setup(db);
			setVersion(dirs.user);
		}
		await indexFiles(db, handle, dirs);
	}
};

const initWatchers = async()=>{
	log('initWatchers');
	const handles = await getAllUserHandles();
	for (const handle of handles) {
		log(handle);
		const dirs = await getUserDirectories(handle);
		watch(dirs.chats, { recursive:true }, (eventType, filename)=>{
			log('watcher:', 'chats', eventType, filename);
			if (!filename?.endsWith('.jsonl')) return;
			const [char, chat] = filename?.split(/[\\/]/);
			reindexQueue.push({
				user: handle,
				char,
				chat,
			});
			processReindexQueue();
		});
		watch(dirs.groupChats, { recursive:true }, (eventType, filename)=>{
			log('watcher:', 'group chats', eventType, filename);
			if (!filename?.endsWith('.jsonl')) return;
			reindexQueue.push({
				user: handle,
				char: null,
				chat: filename,
			});
			processReindexQueue();
		});
	}
};

const registerEndpoints = (router)=>{
	log('registerEndpoints');
	router.get('/', jsonParser, (req, res)=>{
		res.send('chat search plugin is active');
	});

	router.post('/search', jsonParser, async(/**@type {import('express').Request}*/req, /**@type {import('express').Response}*/res)=>{
		log('/chatsearch/search', req.body.query);
		res.writeHead(200, {
			'Content-Type': "text/event-stream",
			'Cache-Control': "no-cache",
			'Connection': "keep-alive",
			'Content-Encoding': 'none',
		});
		const { dbExists, db } = getDb(req.user.directories.user);
		if (!dbExists) {
			// this should never happen unless the index file is removed while ST is running
			warn('db file missing!', req.user.profile.handle);
			setup(db);
			setVersion(req.user.directories.user);
			await indexFiles(db, req.user.profile.handle, req.user.directories);
		}
		writeStatus(res, 'searching');
		const result = await search(db, req.user.profile.handle, req.user.directories, req.body.query, req.body.options, res);
		db.close();
		if (result == null) {
			res.end();
		} else {
			writeResults(res, result.count, result.matches);
		}
		res.end();
	});
}




export async function init(router) {
	log('init');
	await initIndex();
	await initWatchers();
	registerEndpoints(router);
}
export async function exit() {}

const module = {
    init,
    exit,
    info: {
        id: 'chatsearch',
        name: 'Chat Search Plugin',
        description: 'Endpoints to help search through chat files.',
    },
};
export default module;
