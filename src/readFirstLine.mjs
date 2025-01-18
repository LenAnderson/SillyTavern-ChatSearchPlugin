import { createReadStream } from "node:fs";
import readline from "node:readline";

/**
 * Reads the first line of a file.
 * @param {string} filePath
 * @returns {Promise<string>}
 */
export const readFirstLine = async(filePath)=>{
	return new Promise(resolve=>{
		const stream = createReadStream(filePath, { encoding:'utf-8' });
		const rl = readline.createInterface({
			input: stream,
			crlfDelay: Infinity,
		});
		rl.on('line', (line)=>{
			rl.close();
			resolve(line);
		})
		rl.on('close', ()=>{
			rl.close();
			stream.close();
		});
	});
};
