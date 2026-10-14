/* Shared by the public page and the API: restrictions are not only visual. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.BudgetPermissions = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function rules(budget, item) {
        const enabled = budget.customerCanEdit !== false;
        const permissions = item.customerPermissions || {};
        const original = Math.max(1, Math.trunc(Number(item.qty) || 1));
        return {
            remove: enabled && permissions.remove !== false,
            decrease: enabled && permissions.decrease !== false,
            increase: enabled && permissions.increase !== false,
            min: enabled && permissions.decrease !== false ? 1 : original,
            max: enabled && permissions.increase !== false ? Math.max(99, original) : original,
            original
        };
    }
    function sanitize(budget, option, choices) {
        return Object.fromEntries((option.items || []).map(item => {
            const r = rules(budget, item);
            const value = choices?.[item.id] || {};
            const qty = Number(value.qty ?? r.original);
            return [String(item.id), {
                included: r.remove ? value.included !== false : true,
                qty: Math.min(r.max, Math.max(r.min, Number.isFinite(qty) ? Math.trunc(qty) : r.original))
            }];
        }));
    }
    return { rules, sanitize };
});
