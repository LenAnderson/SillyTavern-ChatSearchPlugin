import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 *
 * @param {string} filePath
 * @returns {string}
 */
export const hashFile = (filePath)=>{
	return createHash('md5').update(readFileSync(filePath)).digest('hex')
};
