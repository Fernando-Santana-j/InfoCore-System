const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('WhatsApp event failures are handled without an unhandled rejection',async()=>{
    const source=fs.readFileSync(require.resolve('../lib/whatsapp'),'utf8');
    const handlers={}, statuses=[], logs=[];
    const start=source.indexOf("    socket.ev.on('creds.update'");
    const end=source.indexOf('\n    return socket;',start);
    vm.runInNewContext(source.slice(start,end),{
        socket:{ev:{on:(name,fn)=>handlers[name]=fn}},
        saveCreds:async()=>{throw new Error('disk unavailable')},
        updateQrDataUrl:async()=>{throw new Error('QR failure')},
        setStatus:(status)=>statuses.push(status),console:{error:(...args)=>logs.push(args)}
    });
    await handlers['creds.update']({});
    await handlers['connection.update']({qr:'test'});
    assert.deepEqual(statuses,['error','error']);assert.equal(logs.length,2);
});
