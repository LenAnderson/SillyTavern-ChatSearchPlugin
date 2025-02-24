import { lstat, readFile, Stats } from "node:fs";

/** @type {((path:string|Buffer|URL, options:{encoding:BufferEncoding})=>Promise<string>) & ((path:string|Buffer|URL, options:null)=>Promise<string|Buffer>)} */
export const readFileAsync = async(path, options)=>{
    return new Promise((resolve, reject)=>{
        readFile(path, options, (err, data)=>{
            if (err) reject(err);
            else resolve(data);
        });
    });
};


/**
 *
 * @param {import("node:fs").PathLike} path
 * @returns {Promise<Stats>}
 */
export const lstatAsync = async(path)=>{
    return new Promise((resolve, reject)=>{
        lstat(path, (err, stats)=>{
            if (err) reject(err);
            else resolve(stats);
        });
    });
};
