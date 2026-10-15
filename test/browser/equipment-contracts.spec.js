const {test,expect}=require('@playwright/test');
const fixture=require('../helpers/equipment-contract-fixture');
test('equipment contract imports customer, preserves draft, issues used/new PDFs and fits mobile',async({page,request})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/equipment-sales');await expect(page.locator('#equipmentEditor')).not.toBeVisible();await expect(page.locator('#equipmentConfirm')).not.toBeVisible();await page.locator('#equipmentNew').click();await expect(page.locator('#equipment-condition')).toBeVisible();
 await page.locator('#equipmentCustomer').selectOption('c');await expect(page.locator('#equipment-customerName')).toHaveValue('Maria');
 await expect(page.locator('#equipmentWarrantySummary')).toContainText('Maria');
 await expect(page.locator('[name="witness1Name"]')).toHaveCount(0);
 await page.locator('#equipment-saleDate').fill('2026-10-15');await expect(page.locator('#equipment-deliveryDate')).toHaveValue('2026-10-15');
 await expect(page.locator('#equipment-deliveryDate')).not.toBeVisible();
 await page.locator('#equipmentSameDate').uncheck();await expect(page.locator('#equipment-deliveryDate')).toBeVisible();
 await page.locator('#equipmentSale').selectOption('s');await expect(page.locator('#equipmentSaleHint')).toContainText('VENDA-001');
 for(const condition of ['used','new']){
  if(condition==='new'){await page.locator('#equipmentClose').click();await page.locator('#equipmentNew').click();}
  const data={...fixture(),condition,customerName:`Cliente ${condition}`};
  await page.evaluate(values=>{const form=document.getElementById('equipmentForm');for(const [k,v]of Object.entries(values)){if(k==='checks')v.forEach((x,i)=>form.elements['check'+i].value=x);else if(form.elements[k])form.elements[k].value=v;}form.dispatchEvent(new Event('input',{bubbles:true}));},data);
  await page.locator('#equipmentSave').click();await expect(page.locator('#equipmentMessage')).toContainText('Rascunho salvo');
  await page.reload();await expect(page.locator('#equipmentEditor')).not.toBeVisible();await page.locator('.equipment-contract-card').filter({hasText:`Cliente ${condition}`}).first().click();await expect(page.locator('#equipment-customerName')).toHaveValue(`Cliente ${condition}`);
  await page.locator('#equipmentIssue').click();await page.locator('#equipmentConfirmOk').click();await expect(page.locator('#equipmentStatus')).toHaveText('Emitido');
  const href=await page.locator('#equipmentPdf').getAttribute('href');const pdf=await request.get(href);expect(pdf.ok()).toBeTruthy();expect(pdf.headers()['content-type']).toContain('application/pdf');expect((await pdf.body()).subarray(0,4).toString()).toBe('%PDF');
  await expect(page.locator('#equipment-model')).toBeDisabled();
 }
 for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();for(const selector of ['.equipment-page','.equipment-workspace','.equipment-editor'])expect(await page.locator(selector).evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();}
 await page.evaluate(()=>{document.querySelectorAll('*').forEach(el=>{if(el.scrollTop)el.scrollTop=0;});});
 await page.screenshot({path:'test-results/equipment-contract-mobile.png',fullPage:true});
 await page.locator('#equipmentClose').click();await expect(page.locator('#equipmentEditor')).not.toBeVisible();
 expect(errors).toEqual([]);
});
test('equipment contract blocks issue with unreviewed delivery and restricts private PDFs',async({page,request})=>{
 await page.goto('/equipment-sales');await expect(page.locator('#equipmentEditor')).not.toBeVisible();await expect(page.locator('#equipmentConfirm')).not.toBeVisible();await page.locator('#equipmentNew').click();await expect(page.locator('#equipment-condition')).toBeVisible();
 const input={...fixture(),checks:[],revision:0};const id='unreviewed-contract';expect((await request.put('/api/equipment-contracts/'+id,{data:input})).ok()).toBeTruthy();
 const issued=await request.post('/api/equipment-contracts/'+id+'/issue',{data:{revision:1}});expect(issued.status()).toBe(400);
 for(const role of ['technician','cashier','anonymous']){const res=await request.get('/api/equipment-contracts/'+id+'/pdf',{headers:{'x-test-role':role}});expect(res.status()).toBe(role==='anonymous'?401:403);}
});
