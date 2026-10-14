'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {buildBackup, verifyBackup} = require('./backup-format');
const COLLECTIONS = new Set(['products','customers','budgets','sales','cash_flow','service_orders','budget_templates','service_work_templates','budget_showcases','budget_requests']);
const DEFAULT_DIR = path.join(__dirname, '../data/contingency');
function createSnapshots({dir = DEFAULT_DIR, log = console.warn} = {}) {
    const jobs = new Map();
    const latest = new Map();
    let lastError = -Infinity;
    async function persist(collection, rows) {
        const backup = buildBackup(rows.map(row => ({path:collection+'/'+row.id, data:row})));
        verifyBackup(backup);
        await fs.mkdir(dir, {recursive:true, mode:0o700});
        const file = path.join(dir, collection+'.json');
        const temporary = file+'.'+randomUUID()+'.tmp';
        try {
            await fs.writeFile(temporary, JSON.stringify(backup), {mode:0o600});
            await fs.rename(temporary, file);
        } finally { await fs.unlink(temporary).catch(()=>{}); }
        // Keep the first successful snapshot of each of the last seven saved days.
        const daily = collection+'.'+backup.createdAt.slice(0,10)+'.json';
        await fs.copyFile(file,path.join(dir,daily),require('node:fs').constants.COPYFILE_EXCL).catch(e=>{if(e.code!=='EEXIST')throw e});
        const older = (await fs.readdir(dir)).filter(name=>name.startsWith(collection+'.') && /^\d{4}-\d{2}-\d{2}\.json$/.test(name.slice(collection.length+1))).sort().reverse().slice(7);
        for (const name of older) await fs.unlink(path.join(dir,name));
    }
    function capture(collection, rows) {
        if (!COLLECTIONS.has(collection)) return Promise.resolve();
        latest.set(collection, rows);
        if (jobs.has(collection)) return jobs.get(collection);
        const job = (async()=>{
            while(latest.has(collection)) {
                const value = latest.get(collection);latest.delete(collection);
                try { await persist(collection,value); }
                catch(error) { if(Date.now()-lastError>60000){lastError=Date.now();log('[Contingência local] Não foi possível salvar a cópia: '+error.message);} }
            }
        })().finally(()=>jobs.delete(collection));
        jobs.set(collection,job);
        return job;
    }
    return {capture, flush:()=>Promise.all([...jobs.values()])};
}
module.exports = {...createSnapshots(),createSnapshots,COLLECTIONS,DEFAULT_DIR};
