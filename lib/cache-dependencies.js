'use strict';
// Direct transactional writes invalidate related collections, not the whole app.
module.exports = function dependencies(path) {
    const routes = [
        ['/api/products', ['products']],
        ['/api/budget-templates', ['budget_templates']],
        ['/api/budget-showcases', ['budget_showcases', 'budget_public_responses']],
        ['/api/service-work-templates', ['service_work_templates']],
        ['/api/customers', ['customers']],
        ['/api/cash-flow', ['cash_flow']],
        ['/api/services', ['service_orders', 'budgets', 'customers']],
        ['/api/budgets', ['budgets', 'customers', 'sales', 'products', 'cash_flow']],
        ['/api/sales', ['sales', 'products', 'cash_flow', 'customers', 'budgets']],
        ['/api/public/budgets', ['budgets', 'budget_public_responses']],
        ['/api/public/showcases', ['budget_showcases', 'budget_public_responses']],
    ];
    const found = routes.find(([prefix]) => path === prefix || path.startsWith(prefix + '/'));
    if (path.startsWith('/api/budgets') && !path.endsWith('/convert-sale')) return ['budgets','customers'];
    return found ? found[1] : [];
};
