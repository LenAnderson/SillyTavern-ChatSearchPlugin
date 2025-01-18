/**
 * @typedef {Object} Progress
 * @property {number} max
 * @property {number} current
 * @property {string} text
 */

import { log } from "./console.mjs";


/**
 *
 * @param {import("express").Response?} res
 * @param {string} message
 * @param {Progress[]?} progress
 */
export const writeStatus = (res, message, progress = [])=>{
    if (!res) return;
    log('writeStatus', message);
    res.write(JSON.stringify({
        type: 'status',
        message,
        progress,
    }) + '\n');
};

export const writeResults = (res, count, matches)=>{
    if (!res) return;
    res.write(JSON.stringify({
        type: 'results',
        count,
        matches
    }) + '\n');
};
