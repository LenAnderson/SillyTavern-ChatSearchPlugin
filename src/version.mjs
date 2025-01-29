import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";

import { USER_META } from "./paths.mjs";

export const DB_VERSION = '4';

/**
 * @param {string} dir
 * @returns {string}
 */
export const getVersion = (dir)=>{
    const file = path.join(dir, USER_META, 'version');
    if (existsSync(file)) {
        return readFileSync(file, { encoding: 'utf-8' });
    }
    return '1';
};

/**
 * @param {string} dir
 */
export const setVersion = (dir)=>{
    const file = path.join(dir, USER_META, 'version');
    writeFileSync(file, DB_VERSION);
};
