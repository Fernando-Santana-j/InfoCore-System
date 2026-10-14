const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
test('failed OS photo upload preserves files for a retry on the already created OS', async () => {
    const source=fs.readFileSync(path.join(__dirname,'../public/js/pdv-service.js'),'utf8');
    const pending=new Map([['stage',[new Blob(['photo'])]]]);let ok=false, saves=0;
    const context={svcPendingPhotos:pending,FormData,WorkDrafts:{flush:async()=>{saves++;}},fetch:async()=>({ok})};
    vm.runInNewContext(source.slice(source.indexOf('async function svcUploadPendingPhotos('),source.indexOf('async function svcSubmit(')),context);
    await assert.rejects(context.svcUploadPendingPhotos('existing-os'),/OS foi criada/);
    assert.equal(pending.size,1);assert.equal(saves,0);
    ok=true;await context.svcUploadPendingPhotos('existing-os');assert.equal(pending.size,0);assert.equal(saves,1);
});
