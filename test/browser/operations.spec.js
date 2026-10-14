const { test, expect } = require("@playwright/test");
test.beforeEach(async ({ request }) => {
  await request.post("/__reset");
});
test("budget recovers draft after reload and sharing produces a stable public link", async ({
  page,
}) => {
  await page.goto("/budgets");
  await page.locator("#openCreateBudgetModalBtn").click();
  await page.locator("#budgetCustomerName").fill("Cliente rascunho");
  await expect(
    page.locator("#budgetCreateModal [data-draft-status]"),
  ).toContainText("salvo");
  await page.reload();
  await page.locator("#openCreateBudgetModalBtn").click();
  await expect(page.locator("#budgetCustomerName")).toHaveValue(
    "Cliente rascunho",
  );
  await page.keyboard.press("Escape");
  await page.locator('[data-action="share"]').first().click();
  await page.locator("#budgetPublicLinkBtn").click();
  await expect(page.locator("#budgetPublicLinkValue")).toHaveValue(
    /\/p\/orcamento\//,
  );
  const link = await page.locator("#budgetPublicLinkValue").inputValue();
  expect(link).toContain("/p/orcamento/");
  await page.locator("#budgetPublicLinkBtn").click();
  await expect(page.locator("#budgetPublicLinkValue")).toHaveValue(link);
  const response = await page.request.get(link);
  expect(response.ok()).toBeTruthy();
  expect(await response.text()).not.toContain("unitCost");
});
test("workshop saves equipment and enforces delivery checklist", async ({
  page,
}) => {
  await page.goto("/services/os");
  await page.locator('[name="serial"]').fill("IMEI-001");
  await page.locator('[name="technician"]').fill("João");
  await page.locator('[name="nextAction"]').fill("Combinar retirada");
  await page.getByRole("button", { name: "Salvar ficha", exact: true }).click();
  await expect(page.locator(".work-panel img")).toBeVisible();
  await page.reload();
  await expect(page.locator('[name="serial"]')).toHaveValue("IMEI-001");
  await page
    .getByText("Checklist e confirmação de entrega", { exact: true })
    .click();
  await page.getByRole("button", { name: "Registrar entrega" }).click();
  await expect(page.locator("[data-work-status]")).toContainText(
    "Complete o checklist",
  );
  for (const name of ["tested", "accessoriesChecked", "customerConfirmed"])
    await page.locator(`[name="${name}"]`).check();
  await page.locator('[name="receivedBy"]').fill("Maria");
  await page.getByRole("button", { name: "Registrar entrega" }).click();
  await page
    .getByText("Checklist e confirmação de entrega", { exact: true })
    .click();
  await expect(page.getByText(/Recebido por Maria/)).toBeVisible();
});
test("operator opens cash, receives a partial payment and closes with a difference", async ({
  page,
}) => {
  await page.goto("/cashflow");
  await page.locator('[name="opening"]').fill("50");
  await page.getByRole("button", { name: "Abrir meu caixa" }).click();
  await page.locator('#workReceiptForm [name="amount"]').fill("30");
  await page
    .getByRole("button", { name: "Registrar recebimento", exact: true })
    .click();
  await expect(page.getByText(/Esperado em dinheiro:/)).toContainText("80,00");
  await page.locator('[name="counted"]').fill("78");
  await page.getByRole("button", { name: "Fechar meu caixa" }).click();
  await page.getByText("Fechamentos anteriores", { exact: true }).click();
  await expect(page.getByText(/diferença/).last()).toContainText("-R$");
});
test("multiple held sales survive a fresh browser context for the operator", async ({
  browser,
  request,
}) => {
  await request.post("/api/work/held-sales", {
    data: { cart: [{ id: "p", qty: 1, price: 100 }], customer: "Maria" },
  });
  await request.post("/api/work/held-sales", {
    data: { cart: [{ id: "p", qty: 2, price: 100 }], customer: "José" },
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:3199/attendances");
  await expect(
    page.getByRole("button", { name: "Retomar", exact: true }),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "Retomar", exact: true }).first().click();
  await expect(page).toHaveURL(/\/pdv/);
  await expect(page.locator('#cartItems')).toContainText('SSD');
  await expect(page.locator('.work-panel')).toHaveCount(0);
  await context.close();
});
test("operational panels have no JavaScript errors or mobile overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const path of [
    "/dashboard",
    "/services",
    "/services/os",
    "/analytics",
    "/config",
    "/clients",
  ]) {
    await page.goto(path);
    await expect(page.locator(".work-panel").first()).toBeVisible();
    await expect(page.locator("#pageLoader")).toBeHidden();
    expect(
      await page
        .locator(".work-panel")
        .first()
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 2),
    ).toBeTruthy();
  }
  expect(errors).toEqual([]);
  await page.screenshot({
    path: "test-results/operations-mobile.png",
    fullPage: true,
  });
});

test("workshop creation draft survives reload", async ({ page }) => {
  await page.goto("/services");
  await page.locator("#btnCreateService").click();

  await page.locator("#svcCreateCustomerName").fill("Cliente da oficina");
  await expect(
    page.locator("#svcCreateModal [data-draft-status]"),
  ).toContainText("salvo");
  await page.reload();
  await page.locator("#btnCreateService").click();
  await expect(page.locator("#svcCreateCustomerName")).toHaveValue(
    "Cliente da oficina",
  );
});

test('white public quote exposes terms and totals on mobile without overflow', async ({page,request}) => {
  await page.goto('/budgets');
  await page.locator('[data-action="share"]').first().click();
  await page.locator('#budgetPublicLinkBtn').click();
  await expect(page.locator('#budgetPublicLinkValue')).toHaveValue(/\/p\/orcamento\//);
  const publicLink = await page.locator('#budgetPublicLinkValue').inputValue();
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  for (const width of [320,390,768,1280]) {
    await page.setViewportSize({width,height:844});
    await page.goto(publicLink);
    await expect(page.locator('#overviewTotal')).toContainText('100,00');
    await expect(page.locator('#conditionsCard')).toContainText('Garantia descrita');
    await expect(page.locator('#conditionsCard')).toContainText('Retirada mediante conferência');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    expect(await page.locator('html').evaluate(el=>getComputedStyle(el).colorScheme)).toBe('light');
    const terms = await page.locator('#conditionsSection').boundingBox();
    const items = await page.locator('#customizeSection').boundingBox();
    expect(terms.y).toBeLessThan(items.y);
    await page.screenshot({path:`test-results/quote-${width}.png`,fullPage:true,animations:"disabled"});
  }
  await page.getByRole('button',{name:'Aumentar quantidade de Diagnóstico'}).click();
  await expect(page.locator('#overviewTotal')).toContainText('200,00');
  expect(errors).toEqual([]);
});

test('PDV splits confirmed receipts and blocks incomplete allocation', async ({page}) => {
  await page.goto('/pdv');
  await expect(page.locator('#pageLoader')).toBeHidden();
  await page.locator('.pdv-product-card').filter({hasText:'SSD'}).click();
  await page.locator('#btnFinalizeSale').click();
  await page.locator('#splitPaymentEnabled').check();
  await page.locator('[data-split-method="pix"]').fill('50');
  await expect(page.locator('#splitPaymentBalance')).toContainText('50,00');
  let payload;
  await page.route('**/api/sales',route=>{
    payload=route.request().postDataJSON();
    return route.fulfill({json:{error:false,sale:{id:'test-split',total:100,payment:'mixed',payments:payload.payments},products:[]}});
  });
  await page.locator('#confirmActionBtn').click();
  expect(payload).toBeUndefined();
  await page.locator('[data-split-method="money"]').fill('50');
  await expect(page.locator('#splitPaymentBalance')).toHaveText('Total conferido.');
  await page.locator('#splitPaymentConfirmed').check();
  await page.locator('#confirmActionBtn').click();
  await expect.poll(()=>payload?.payment).toBe('mixed');
  expect(payload.payments).toEqual([{method:'pix',amount:50},{method:'money',amount:50}]);
  expect(payload.paymentsConfirmed).toBe(true);
  await expect(page.locator('#cartCount')).toContainText('0 un.');
  await expect(page.locator('.work-panel')).toHaveCount(0);
});

test('public quote hides empty conditions and honors per-item and global locks', async ({page,request})=>{
 await request.post('/__budget',{data:{publicToken:'permissions-test',warrantyText:'  ',notes:'',deadline:'',paymentTerms:'',options:[{id:'o',name:'Proposta',items:[{id:'fixed',name:'Item fixo',qty:3,unitPrice:10,customerPermissions:{remove:false,decrease:false,increase:false}},{id:'optional',name:'Item opcional',qty:2,unitPrice:10,customerPermissions:{remove:true,decrease:true,increase:false}}]}]}});
 await page.setViewportSize({width:390,height:844});
 await page.goto('/p/orcamento/permissions-test');
 await expect(page.locator('#conditionsSection')).toBeHidden();
 await expect(page.locator('#conditionsNav')).toBeHidden();
 await expect(page.getByRole('checkbox',{name:'Incluir Item fixo'})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Aumentar quantidade de Item fixo'})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Diminuir quantidade de Item fixo'})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Aumentar quantidade de Item opcional'})).toBeDisabled();
 await page.getByRole('button',{name:'Diminuir quantidade de Item opcional'}).click();
 await expect(page.locator('#overviewTotal')).toContainText('40,00');
 await page.getByRole('checkbox',{name:'Incluir Item opcional'}).uncheck();
 await expect(page.locator('#overviewTotal')).toContainText('30,00');
 await request.post('/__budget',{data:{customerCanEdit:false}});
 await page.reload();
 await expect(page.locator('#overviewTotal')).toContainText('50,00');
 await expect(page.getByRole('checkbox',{name:'Incluir Item opcional'})).toBeChecked();
 await expect(page.getByRole('checkbox',{name:'Incluir Item opcional'})).toBeDisabled();
 await expect(page.locator('#customizeHint')).toContainText('definidos pela loja');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});

test('budget editor preserves individual permissions in its save payload',async({page})=>{
 await page.goto('/budgets');
 await page.locator('[data-action="edit"]').first().click();
 await page.locator('#budgetEditorNextBtn').click();
 await page.locator('[data-customer-permission="remove"]').first().uncheck();
 await page.locator('[data-customer-permission="increase"]').first().uncheck();
 await page.locator('#budgetCustomerCanEdit').uncheck();
 const payload=await page.evaluate(()=>budgetPayload());
 expect(payload.customerCanEdit).toBe(false);
 expect(payload.options[0].items[0].customerPermissions).toEqual({remove:false,decrease:true,increase:false});
});

test('attendance navigation keeps search and offers clear empty states on mobile',async({page,request})=>{
 await request.post('/api/work/held-sales',{data:{cart:[{id:'p',qty:2,price:100}],customer:'Maria'}});
 await page.setViewportSize({width:390,height:844});
 await page.goto('/attendances');
 await page.locator('#attendanceSearch').fill('José');
 await expect(page.locator('[data-search-empty]')).toBeVisible();
 await page.locator('[data-attendance-tab="payments"]').click();
 await expect(page.getByText('Tudo em dia.',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'Atualizar',exact:true}).click();
 await expect(page.locator('[data-attendance-tab="payments"]')).toHaveAttribute('aria-pressed','true');
 await page.locator('[data-attendance-tab="held"]').click();
 await expect(page.locator('#attendanceSearch')).toHaveValue('José');
 await page.locator('#attendanceSearch').fill('Maria');
 await expect(page.getByRole('button',{name:'Retomar',exact:true})).toBeVisible();
 expect(await page.locator('.attendance-panel').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
 await page.screenshot({path:'test-results/attendances-polished.png',fullPage:true});
});

test('permission presets and global lock preserve the chosen rules',async({page})=>{
 await page.goto('/budgets');
 await page.locator('[data-action="edit"]').first().click();
 await page.locator('#budgetEditorNextBtn').click();
 const optional=page.locator('#budgetItemsList [data-permission-preset="optional"]').first();
 await optional.click();
 await expect(optional).toHaveAttribute('aria-pressed','true');
 await page.locator('#budgetCustomerCanEdit').uncheck();
 await expect(optional).toBeDisabled();
 await expect(page.locator('#budgetPermissionsHint')).toContainText('Edição bloqueada');
 await page.locator('#budgetCustomerCanEdit').check();
 await expect(optional).toBeEnabled();
 expect(await page.evaluate(()=>budgetPayload().options[0].items[0].customerPermissions)).toEqual({remove:true,decrease:false,increase:false});
});

test('split payment shortcuts preserve cents and reset confirmation when edited',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto('/pdv');
 await page.locator('.pdv-product-card').filter({hasText:'SSD'}).click();
 await page.evaluate(()=>{window.appData.cart[0].price=100.01;renderCart();});
 await page.locator('#btnFinalizeSale').click();
 await page.locator('#splitPaymentEnabled').check();
 await page.locator('#splitHalfBtn').click();
 await expect(page.locator('[data-split-method="pix"]')).toHaveValue('50.00');
 await expect(page.locator('[data-split-method="money"]')).toHaveValue('50.01');
 await page.locator('#splitPaymentConfirmed').check();
 await page.locator('[data-split-method="pix"]').fill('25');
 await expect(page.locator('#splitPaymentConfirmed')).not.toBeChecked();
 await expect(page.locator('#splitPaymentConfirmed')).toBeDisabled();
 await page.locator('[data-split-fill="money"]').click();
 await expect(page.locator('[data-split-method="money"]')).toHaveValue('75.01');
 await expect(page.locator('#splitPaymentConfirmed')).toBeEnabled();
 await page.locator('#splitPaymentEnabled').uncheck();
 await expect(page.locator('#confirmPaymentLabel')).not.toContainText('dividido');
 await page.locator('#splitPaymentEnabled').check();
 await expect(page.locator('#confirmPaymentLabel')).toContainText('dividido');
 expect(await page.locator('#splitPaymentSection').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
 await expect(page.locator('#confirmActionBtn')).toBeInViewport();
 await page.screenshot({path:'test-results/split-polished.png',fullPage:true});
});

test('customer can undo an allowed increase and review before confirming on mobile',async({page,request})=>{
 await request.post('/__budget',{data:{publicToken:'review-test',options:[{id:'o',name:'Proposta',items:[{id:'up',name:'Memória',qty:2,unitPrice:50,customerPermissions:{remove:false,decrease:false,increase:true}}]}]}});
 await page.setViewportSize({width:390,height:844});
 await page.goto('/p/orcamento/review-test');
 const decrease=page.getByRole('button',{name:'Diminuir quantidade de Memória'});
 await expect(decrease).toBeDisabled();
 await page.getByRole('button',{name:'Aumentar quantidade de Memória'}).click();
 await expect(decrease).toBeEnabled();
 await decrease.click();
 await expect(decrease).toBeDisabled();
 await expect(page.locator('#overviewTotal')).toContainText('100,00');
 await page.locator('#mobileFinishBtn').click();
 await expect(page.locator('#summaryTitle')).toBeFocused();
 await expect(page.locator('#finishBtn')).toHaveText(/Finalizar minhas escolhas/);
});

test('cashier submits a photographed request; technician approves and creates a linked draft',async({browser,request})=>{
 const cashier=await browser.newContext({extraHTTPHeaders:{'x-test-role':'cashier'},viewport:{width:390,height:844}});
 const page=await cashier.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:3199/budgets');
 await expect(page.locator('#openCreateBudgetModalBtn')).toBeHidden();
 await expect(page.locator('[data-action="edit"]')).toHaveCount(0);
 expect((await page.request.post('/api/budgets',{data:{}})).status()).toBe(403);
 await page.goto('http://127.0.0.1:3199/budget-requests');
 await page.locator('[name="customerName"]').fill('Cliente solicitado');
 await page.locator('[name="customerPhone"]').fill('79999999999');
 await page.locator('[name="device"]').fill('Notebook para análise');
 await page.locator('[name="description"]').fill('Desliga após alguns minutos.');
 await page.getByLabel('Superaquecimento',{exact:true}).check();
 await page.locator('#requestPhotos').setInputFiles({name:'problema.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64')});
 await page.getByRole('button',{name:'Enviar solicitação',exact:true}).click();
 await expect(page.locator('#requestDetail')).toContainText('Cliente solicitado');
 await expect(page.locator('#requestDetail .request-photos img')).toHaveCount(1);
 await expect(page.locator('[data-review]')).toHaveCount(0);
 const j=await (await page.request.get('/api/budget-requests')).json();const intake=j.requests[0];
 expect((await page.request.patch(`/api/budget-requests/${intake.id}/review`,{data:{status:'approved',reviewNotes:'teste'}})).status()).toBe(403);
 expect((await request.get(intake.photos[0].url,{headers:{'x-test-role':'anonymous'}})).status()).toBe(401);
 expect(await page.locator('.request-page').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
 await page.screenshot({path:'test-results/request-cashier-mobile.png',fullPage:true});
 const tech=await browser.newContext({extraHTTPHeaders:{'x-test-role':'technician'}});const technical=await tech.newPage();
 await technical.goto(`http://127.0.0.1:3199/budget-requests?open=${intake.id}`);
 await technical.locator('#requestReviewNotes').fill('Limpeza e revisão do cooler.');
 await technical.locator('[data-review="approved"]').click();
 await expect(technical.locator('#requestCreateBudget')).toBeVisible();
 await technical.locator('#requestCreateBudget').click();
 await expect(technical).toHaveURL(/\/budgets\?open=request-/);
 await expect(technical.locator('#budgetCreateModal')).toBeVisible();
 await expect(technical.locator('#budgetCustomerName')).toHaveValue('Cliente solicitado');
 await expect(technical.locator('#budgetNotes')).toHaveValue(/Desliga após/);
 await expect(technical.locator('#budgetIntakeContext')).toContainText('Limpeza e revisão do cooler');
 expect(errors).toEqual([]);await cashier.close();await tech.close();
});

test('item image upload reaches editor payload and shared quote without overflow',async({page,request})=>{
 await page.goto('/budgets');await page.locator('[data-action="edit"]').first().click();await page.locator('#budgetEditorNextBtn').click();
 await page.locator('.item-image-file').first().setInputFiles({name:'ssd.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64')});
 await expect(page.locator('.budget-item-thumb img').first()).toBeVisible();
 const payload=await page.evaluate(()=>budgetPayload());expect(payload.options[0].items[0].imageUrl).toBe('/img/logo_bg.png');
 await request.post('/__budget',{data:{publicToken:'item-photo',options:payload.options}});
 await page.setViewportSize({width:390,height:844});await page.goto('/p/orcamento/item-photo');
 await expect(page.locator('.public-item-photo img')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.screenshot({path:'test-results/quote-item-photo-mobile.png',fullPage:true,animations:'disabled'});
});

test('request attachments reject disguised files and edits from another cashier',async({request})=>{
 const data={id:'photo-security-test',customerName:'Maria',customerPhone:'79999999999',device:'Notebook',description:'Não liga'};
 await request.post('/api/budget-requests',{headers:{'x-test-role':'cashier'},data});
 const wrongOwner=await request.post('/api/budget-requests/photo-security-test/photos',{headers:{'x-test-role':'another-cashier'},multipart:{image:{name:'x.png',mimeType:'image/png',buffer:Buffer.from('not an image')}}});
 expect(wrongOwner.status()).toBe(403);
 const invalid=await request.post('/api/budget-requests/photo-security-test/photos',{headers:{'x-test-role':'cashier'},multipart:{image:{name:'x.png',mimeType:'image/png',buffer:Buffer.from('<html>not an image</html>')}}});
 expect(invalid.status()).toBe(400);
 const saved=await (await request.get('/api/budget-requests/photo-security-test')).json();
 expect(saved.request.photos).toEqual([]);
});


test('PDV records only an intake, restores it on mobile, and approved quote creates one complete OS', async ({browser,request}) => {
 const cashier=await browser.newContext({extraHTTPHeaders:{'x-test-role':'cashier'},viewport:{width:390,height:844}});
 const page=await cashier.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:3199/pdv');
 await page.locator('#btnOpenServiceIntakeModal').click();
 await page.locator('[name="customerName"]').fill('Entrada pelo PDV');
 await page.locator('[name="customerPhone"]').fill('79999999999');
 await page.locator('[name="device"]').fill('Notebook Dell');
 await page.locator('[name="deviceType"]').selectOption('Notebook');
 await page.locator('[name="serialNumber"]').fill('SERIAL-123');
 await page.locator('[name="accessories"]').fill('Fonte original');
 await page.locator('[name="physicalCondition"]').fill('Risco na tampa');
 await page.getByLabel('Não liga',{exact:true}).check();
 await page.locator('[name="description"]').fill('Parou de ligar ontem');
 await page.locator('#requestPhotos').setInputFiles({name:'entrada.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64')});
 await expect(page.locator('#requestForm [data-draft-status]')).toContainText('salvo');
 await page.reload();await page.locator('#btnOpenServiceIntakeModal').click();
 await expect(page.locator('[name="serialNumber"]')).toHaveValue('SERIAL-123');
 await expect(page.getByLabel('Não liga',{exact:true})).toBeChecked();
 await expect(page.locator('#requestPhotoPreview img')).toHaveCount(1);
 expect(await page.locator('.request-modal-card').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
 const footer=await page.locator('#serviceIntakeModal .pdv-modal-footer').boundingBox();expect(footer.y+footer.height).toBeLessThanOrEqual(845);
 await page.screenshot({path:'test-results/pdv-request-mobile.png',fullPage:true,animations:'disabled'});
 await page.getByRole('button',{name:'Enviar solicitação',exact:true}).click();
 await expect(page.locator('#requestDetail')).toContainText('Entrada pelo PDV');
 const intake=(await (await page.request.get('/api/budget-requests')).json()).requests[0];
 expect(intake.budgetId).toBeUndefined();expect(intake.serviceOrderId).toBeUndefined();
 const tech=await browser.newContext({extraHTTPHeaders:{'x-test-role':'technician'}});const tp=await tech.newPage();
 await tp.goto('http://127.0.0.1:3199/budget-requests?open='+intake.id);
 await tp.locator('#requestReviewNotes').fill('Verificar alimentação');
 await tp.locator('#requestDestination').selectOption('service_after_approval');
 await tp.locator('[data-review="approved"]').click();
 await expect(tp.locator('#requestCreateBudget')).toBeVisible();
 await tp.locator('#requestCreateBudget').click();await expect(tp).toHaveURL(/budgets\?open=/);
 await tp.goto('http://127.0.0.1:3199/budget-requests?open='+intake.id);
 await tp.locator('#requestCreateService').click();
 await expect(tp.locator('#requestDetailStatus')).toContainText('precisa estar aprovado');
 await request.post('/__approve-budget/request-'+intake.id);
 await tp.locator('#requestCreateService').click();await expect(tp).toHaveURL(/services\/request-/);
 await tp.locator('#serviceRequestOrigin summary').click();
 await expect(tp.locator('#serviceRequestOrigin')).toContainText('SERIAL-123');
 await expect(tp.locator('#serviceRequestOrigin')).toContainText('Risco na tampa');
 await expect(tp.locator('#serviceRequestOrigin')).toContainText('Verificar alimentação');
 await expect(tp.locator('#serviceRequestOrigin img')).toHaveCount(1);
 const retry=await tp.request.post('/api/budget-requests/'+intake.id+'/service');expect(retry.ok()).toBeTruthy();
 expect((await retry.json()).service.id).toBe('request-'+intake.id);
 expect(errors).toEqual([]);await cashier.close();await tech.close();
});

test('shared intake on PDV and budgets fills registered customer and loads only on demand', async ({page}) => {
  const calls=[];
  page.on('request',r=>{if(r.url().includes('/api/budget-requests'))calls.push(r.url())});
  for (const route of ['/pdv','/budgets']) {
    await page.goto(route);
    await page.locator('#btnOpenServiceIntakeModal').waitFor();
    const before=calls.length;
    await page.locator('#btnOpenServiceIntakeModal').click();
    await expect(page.locator('#serviceIntakeModal')).toBeVisible();
    await page.locator('#requestCustomerSearch').fill('Maria');
    await page.getByRole('option', {name:/Maria/}).click();
    await expect(page.locator('#requestForm [name=customerName]')).toHaveValue('Maria');
    await expect(page.locator('#requestForm [name=customerPhone]')).toHaveValue('79999999999');
    await expect(page.locator('#requestForm [name=customerEmail]')).toHaveValue('maria@example.test');
    await expect(page.locator('#requestCustomerId')).toHaveValue('c');
    expect(calls.length-before).toBe(1);
    expect(calls.at(-1)).toContain('/intake-options');
    await page.locator('#requestCustomerSearch').fill('Maria teste');
    expect(calls.length-before).toBe(1);
    await page.locator('#closeServiceIntakeModalBtn').click();
    await page.locator('#btnOpenServiceIntakeModal').click();
    expect(calls.length-before).toBe(1);
    await page.getByRole('button', {name:'Preencher manualmente',exact:true}).click();
    await expect(page.locator('#requestCustomerId')).toHaveValue('');
    await expect(page.locator('#requestForm [name=customerPhone]')).toHaveValue('');
    await page.locator('#closeServiceIntakeModalBtn').click();
  }
  await page.goto('/pdv');
  await page.getByRole('link',{name:'+ Novo orçamento',exact:true}).click();
  await expect(page.locator('#budgetCreateModal')).toBeVisible();
});


test('intake autocomplete supports keyboard, empty results and mobile selection',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/budgets');
  await page.locator('#btnOpenServiceIntakeModal').click();
  const search=page.locator('#requestCustomerSearch');
  await search.fill('79999999999');
  await expect(page.getByRole('option',{name:/Maria/})).toBeVisible();
  await page.screenshot({path:'test-results/intake-autocomplete-mobile.png',animations:'disabled'});
  await search.press('Enter');
  await expect(page.locator('#requestCustomerId')).toHaveValue('c');
  await expect(page.locator('#requestCustomerResults')).toBeHidden();
  await search.fill('cliente inexistente');
  await expect(page.locator('#requestCustomerResults')).toContainText('Nenhum cliente encontrado');
  await search.press('Escape');
  await expect(page.locator('#requestCustomerResults')).toBeHidden();
  await expect(page.locator('#serviceIntakeModal')).toBeVisible();
  await page.locator('#requestForm [name=customerName]').fill('Outro cliente');
  await expect(page.locator('#requestCustomerId')).toHaveValue('');
  expect(await page.locator('.request-modal-card').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
});
