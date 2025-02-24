import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

// Plugin
import { log } from "./console.mjs";


/**
 * @param {string} userDir
 * @returns {{dbExists:boolean, db:DatabaseSync}}
 */
export const getDb = (userDir, readOnly = false)=>{
	log('getDb', userDir);
	const dir = path.resolve(path.join(userDir, 'ChatSearch'));
	const dbPath = path.resolve(path.join(dir, 'index.db'));
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive:true });
	}
	const dbExists = existsSync(dbPath);
	const db = new DatabaseSync(dbPath, { readOnly: dbExists && readOnly });
	return { dbExists, db };
};


/**
 * @typedef {Object} chatRow
 * @property {number} id
 * @property {string} meta_hash
 * @property {string} filename
 * @property {number} modified_on
 * @property {string} file_hash
 * @property {string} character_id
 * @property {string} group_id
 * @property {string} absolute_path
 */

/**
 * @typedef {Object} messageRow
 * @property {number} id
 * @property {number} chat_id
 * @property {number} message_index
 * @property {number} swipe_index
 * @property {string} name
 * @property {number} is_user
 * @property {number} is_system
 */

/**
 * @typedef {Object} swipeRow
 * @property {number} id
 * @property {number} message_id
 * @property {number} swipe_index
 * @property {string} send_date
 * @property {string} content
 */

/**
 * @typedef {Object} resultRow
 * @property {string} handle
 * @property {number} chat_id
 * @property {string} character_id
 * @property {string} group_id
 * @property {string} filename
 * @property {string} message_index
 * @property {number} message_swipe_index
 * @property {string} name
 * @property {number} is_user
 * @property {number} is_system
 * @property {number} swipe_index
 * @property {string} send_date
 * @property {string} content
 */

/**
 * @typedef {Object} countRow
 * @property {number} results
 */


/**
 * @param {DatabaseSync} db
 */
export const setup = (db)=>{
	log('setup');
	try { db.exec('DROP TABLE swipe'); } catch {}
	try { db.exec('DROP TABLE message'); } catch {}
	try { db.exec('DROP TABLE chat'); } catch {}
	db.exec(`
		CREATE TABLE chat (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			meta_hash TEXT,
			filename TEXT,
			modified_on NUMBER,
			file_hash TEXT,
			character_id TEXT,
			group_id TEXT,
			absolute_path TEXT
		);
		CREATE TABLE message (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			chat_id INTEGER,
			message_index INTEGER,
			swipe_index INTEGER,
			name TEXT,
            is_user INTEGER,
            is_system INTEGER,
			FOREIGN KEY (chat_id) REFERENCES chat(id) ON DELETE CASCADE
		);
		CREATE TABLE swipe (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			message_id INTEGER,
			swipe_index INTEGER,
			send_date TEXT NULL,
			content TEXT,
			FOREIGN KEY (message_id) REFERENCES message(id) ON DELETE CASCADE
		);
	`);
};


/**
 * @param {object} options
 * @param {boolean} [options.count]
 * @param {boolean} [options.swipes]
 * @param {boolean} [options.hidden]
 * @param {boolean} [options.limit]
 * @param {boolean} [options.user]
 * @param {boolean} [options.bot]
 * @returns {string}
 */
export const buildQuery = (options = { count:false, swipes:false, hidden:false, user:true, bot:true, limit:true, })=>{
	return [
		'SELECT',
		options.count
			? '	COUNT(1) AS results'
			: `
				? AS handle,
				c.id AS chat_id,
				c.character_id,
				c.group_id,
				c.filename,
				m.message_index,
				m.swipe_index AS message_swipe_index,
				m.name,
				m.is_user,
				m.is_system,
				s.swipe_index,
				s.send_date,
				s.content
			`,
		`FROM
			chat c
			LEFT OUTER JOIN message m ON c.id = m.chat_id
			LEFT OUTER JOIN swipe s ON m.id = s.message_id
		WHERE
			s.content LIKE ?
		`,
		options.swipes ? null : '	AND m.swipe_index = s.swipe_index',
		options.hidden ? null : '	AND m.is_system = 0',
		`	AND (
				1 = 2`,
		options.user ? '		OR m.is_user = 1' : null,
		options.bot  ? '		OR m.is_user = 0' : null,
		'	)',
		!options.count && options.limit ? 'LIMIT ?' : null
	].join('\n');
};
