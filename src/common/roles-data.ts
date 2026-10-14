export interface TaskDef {
  id: string;
  label: string;
  right: 'create' | 'view' | 'edit' | 'delete' | 'export';
}

export interface ResourceDef {
  id: string;
  name: string;
  category: string;
  description: string;
  tasks: TaskDef[];
}

export interface RightDef {
  id: string;
  label: string;
  description: string;
}

export const RIGHTS: RightDef[] = [
  { id: 'create', label: 'CREATE', description: 'Can create new records' },
  { id: 'view', label: 'READ', description: 'Can view records and lists' },
  { id: 'edit', label: 'UPDATE', description: 'Can edit and update existing records' },
  { id: 'delete', label: 'DELETE', description: 'Can delete or remove records' },
  { id: 'export', label: 'EXPORT', description: 'Can export to Excel or download files' },
];

export const RESOURCES: ResourceDef[] = [
  {
    id: 'users',
    name: 'User Management',
    category: 'Administration',
    description: 'Manage user accounts, credentials, and company access...',
    tasks: [
      { id: 'create_user', label: 'Create User', right: 'create' },
      { id: 'read_user', label: 'Read User Details', right: 'view' },
      { id: 'update_user', label: 'Update Account Info', right: 'edit' },
      { id: 'assign_roles_companies', label: 'Assign Roles & Companies', right: 'edit' },
      { id: 'delete_user', label: 'Delete User Account', right: 'delete' },
      { id: 'export_users', label: 'Export User List', right: 'export' },
    ],
  },
  {
    id: 'roles',
    name: 'Role & Permissions',
    category: 'Administration',
    description: 'Manage dynamic roles and access controls...',
    tasks: [
      { id: 'create_role', label: 'Create Role', right: 'create' },
      { id: 'read_role', label: 'Read Role & Matrix', right: 'view' },
      { id: 'update_role', label: 'Update Permissions', right: 'edit' },
      { id: 'delete_role', label: 'Delete Role', right: 'delete' },
      { id: 'export_roles', label: 'Export Roles', right: 'export' },
    ],
  },
  {
    id: 'purchases',
    name: 'Purchases',
    category: 'Transactions',
    description: 'Manage vendor invoices, goods receipts, and payment terms...',
    tasks: [
      { id: 'create_purchase', label: 'Create Purchase Invoice', right: 'create' },
      { id: 'read_purchase', label: 'Read Invoices & Receipts', right: 'view' },
      { id: 'update_purchase', label: 'Update Invoices & Goods', right: 'edit' },
      { id: 'delete_purchase', label: 'Delete Purchase Invoice', right: 'delete' },
      { id: 'export_purchase', label: 'Export Purchase Register', right: 'export' },
      { id: 'record_payment_p', label: 'Record Credit Payment', right: 'edit' },
    ],
  },
  {
    id: 'sales',
    name: 'Sales',
    category: 'Transactions',
    description: 'Manage sales invoices, customer receipts, and billing...',
    tasks: [
      { id: 'create_sales', label: 'Create Sales Invoice', right: 'create' },
      { id: 'read_sales', label: 'Read Sales Records', right: 'view' },
      { id: 'update_sales', label: 'Update Sales Invoice', right: 'edit' },
      { id: 'delete_sales', label: 'Delete Sales Invoice', right: 'delete' },
      { id: 'export_sales', label: 'Export Sales Summary', right: 'export' },
    ],
  },
  {
    id: 'reconciliation',
    name: 'Bank Reconciliation',
    category: 'Transactions',
    description: 'Manage bank statements, auto-matching, and ledger entries...',
    tasks: [
      { id: 'import_bank', label: 'Import Bank Statement (Excel)', right: 'create' },
      { id: 'read_reconcil', label: 'Read Accounts & Entries', right: 'view' },
      { id: 'run_automatch', label: 'Run Auto-Matching Engine', right: 'edit' },
      { id: 'create_bank_tx', label: 'Add Adjustment Entry', right: 'create' },
      { id: 'delete_bank_tx', label: 'Delete Bank Transactions', right: 'delete' },
      { id: 'export_reconcil', label: 'Export Reconciliation Sheets', right: 'export' },
    ],
  },
  {
    id: 'parties',
    name: 'Suppliers & Customers',
    category: 'Master data',
    description: 'Manage company directory, TIN profiles, and MRC registrations...',
    tasks: [
      { id: 'create_party', label: 'Add Supplier or Customer', right: 'create' },
      { id: 'read_party', label: 'Read Directory & TIN', right: 'view' },
      { id: 'update_party', label: 'Update Profiles & MRC', right: 'edit' },
      { id: 'delete_party', label: 'Delete Company Record', right: 'delete' },
      { id: 'export_parties', label: 'Export Company Directory', right: 'export' },
    ],
  },
  {
    id: 'inventory',
    name: 'Inventory & Stock',
    category: 'Stock',
    description: 'Manage stock ledger, store issues, and item movements...',
    tasks: [
      { id: 'create_issue', label: 'Record Store Issue / Receipt', right: 'create' },
      { id: 'read_stock', label: 'Read Stock Ledger & Balances', right: 'view' },
      { id: 'update_stock', label: 'Update Quantities & Minimums', right: 'edit' },
      { id: 'delete_issue', label: 'Delete Store Issue Voucher', right: 'delete' },
      { id: 'export_stock', label: 'Export Inventory Balance', right: 'export' },
    ],
  },
  {
    id: 'withholding',
    name: 'Withholding Tax',
    category: 'Tax',
    description: 'Manage purchase and sales withholding receipts and tax filing...',
    tasks: [
      { id: 'create_wh', label: 'Create Withholding Receipt', right: 'create' },
      { id: 'read_wh', label: 'Read Withholding Register', right: 'view' },
      { id: 'update_wh', label: 'Update Receipt Details', right: 'edit' },
      { id: 'delete_wh', label: 'Delete Withholding Receipt', right: 'delete' },
      { id: 'export_wh', label: 'Export Tax Filing Summary', right: 'export' },
    ],
  },
  {
    id: 'credit',
    name: 'Credit & Payments',
    category: 'Finance',
    description: 'Manage payables, receivables, aging and payment tracking...',
    tasks: [
      { id: 'create_payment', label: 'Record Payment Voucher', right: 'create' },
      { id: 'read_credit', label: 'Read Outstanding Balances', right: 'view' },
      { id: 'update_credit', label: 'Update Payment Allocations', right: 'edit' },
      { id: 'delete_payment', label: 'Delete Payment Voucher', right: 'delete' },
      { id: 'export_credit', label: 'Export Aging Statement', right: 'export' },
    ],
  },
  {
    id: 'vat',
    name: 'VAT Declaration',
    category: 'Tax',
    description: 'Manage monthly VAT declarations and official filings...',
    tasks: [
      { id: 'read_vat', label: 'Read Monthly VAT Return', right: 'view' },
      { id: 'update_vat', label: 'Post VAT Adjustments', right: 'edit' },
      { id: 'export_vat', label: 'Export ERCA VAT Declaration', right: 'export' },
    ],
  },
  {
    id: 'products',
    name: 'Product Master',
    category: 'Master data',
    description: 'Manage product catalog, pricing, serial numbers, and units...',
    tasks: [
      { id: 'create_product', label: 'Add Product to Catalog', right: 'create' },
      { id: 'read_product', label: 'Read Catalog & Pricing', right: 'view' },
      { id: 'update_product', label: 'Update Prices & Codes', right: 'edit' },
      { id: 'delete_product', label: 'Delete Product Record', right: 'delete' },
      { id: 'export_product', label: 'Export Catalog to Excel', right: 'export' },
    ],
  },
  {
    id: 'reports',
    name: 'Financial Reports',
    category: 'Reports',
    description: 'Manage financial reports, registers, and executive summaries...',
    tasks: [
      { id: 'read_reports', label: 'Read Registers & Analytics', right: 'view' },
      { id: 'export_reports', label: 'Export Reports to Excel', right: 'export' },
    ],
  },
  {
    id: 'settings',
    name: 'System Settings',
    category: 'Administration',
    description: 'Manage company details, tax rates, and thresholds...',
    tasks: [
      { id: 'read_settings', label: 'Read System Configuration', right: 'view' },
      { id: 'update_settings', label: 'Update Company Info & Rules', right: 'edit' },
    ],
  },
  {
    id: 'lookups',
    name: 'Dropdown Lists',
    category: 'Administration',
    description: 'Manage measurement units, payment methods, and categories...',
    tasks: [
      { id: 'read_lookups', label: 'Read Units & Lookups', right: 'view' },
      { id: 'update_lookups', label: 'Update Dropdown Lists', right: 'edit' },
    ],
  },
  {
    id: 'audit',
    name: 'Activity Log',
    category: 'Administration',
    description: 'Manage audit trail, login history, and security events...',
    tasks: [
      { id: 'read_audit', label: 'Read Activity Log', right: 'view' },
      { id: 'export_audit', label: 'Export Audit Trail', right: 'export' },
    ],
  },
  {
    id: 'export',
    name: 'Data Export & Backup',
    category: 'Administration',
    description: 'Manage database backups, snapshots, and downloads...',
    tasks: [
      { id: 'read_export', label: 'Read Backup History', right: 'view' },
      { id: 'download_backup', label: 'Download System Backup', right: 'export' },
    ],
  },
];

export function buildDefaultRolePermissions() {
  const allRes = RESOURCES.map((r) => r.id);
  const allRights = RIGHTS.map((r) => r.id);

  const fullAccess = () => Object.fromEntries(
    allRes.map((res) => [res, Object.fromEntries(allRights.map((rt) => [rt, true]))])
  );

  const customAccess = (ruleMap: Record<string, string[]>) => {
    const perm: Record<string, Record<string, boolean>> = Object.fromEntries(
      allRes.map((res) => [res, Object.fromEntries(allRights.map((rt) => [rt, false]))])
    );
    for (const [res, rights] of Object.entries(ruleMap)) {
      if (perm[res]) {
        for (const rt of rights) {
          if (perm[res][rt] !== undefined) perm[res][rt] = true;
        }
      }
    }
    return perm;
  };

  const admin = fullAccess();

  const accountant = customAccess({
    purchases: allRights,
    sales: allRights,
    reconciliation: allRights,
    withholding: allRights,
    credit: allRights,
    inventory: ['view', 'export'],
    vat: allRights,
    parties: ['view', 'create', 'edit', 'export'],
    products: ['view', 'export'],
    reports: allRights,
    settings: ['view'],
    lookups: ['view'],
    audit: ['view', 'export'],
    export: allRights,
  });

  const salesOfficer = customAccess({
    sales: ['view', 'create', 'edit', 'export'],
    parties: ['view', 'create', 'edit'],
    credit: ['view', 'export'],
    products: ['view'],
    inventory: ['view'],
    reports: ['view', 'export'],
    export: ['view', 'export'],
  });

  const purchaseOfficer = customAccess({
    purchases: ['view', 'create', 'edit', 'export'],
    parties: ['view', 'create', 'edit'],
    credit: ['view', 'export'],
    products: ['view'],
    inventory: ['view'],
    reports: ['view', 'export'],
    export: ['view', 'export'],
  });

  const viewer = customAccess({
    purchases: ['view', 'export'],
    sales: ['view', 'export'],
    reconciliation: ['view', 'export'],
    withholding: ['view', 'export'],
    credit: ['view', 'export'],
    inventory: ['view', 'export'],
    vat: ['view', 'export'],
    parties: ['view', 'export'],
    products: ['view', 'export'],
    reports: ['view', 'export'],
    settings: ['view'],
    lookups: ['view'],
    audit: ['view', 'export'],
    export: ['view', 'export'],
  });

  return [
    {
      name: 'admin',
      label: 'Administrator',
      description: 'Unrestricted full access across all modules, company settings, and user management',
      is_system: 1,
      permissions: admin,
    },
    {
      name: 'accountant',
      label: 'Accountant',
      description: 'Full access to transactions, bank reconciliation, tax declarations, and financial reports',
      is_system: 1,
      permissions: accountant,
    },
    {
      name: 'sales_officer',
      label: 'Sales Officer',
      description: 'Manage sales invoices, customer companies, view inventory, and sales reports',
      is_system: 1,
      permissions: salesOfficer,
    },
    {
      name: 'purchase_officer',
      label: 'Purchase Officer',
      description: 'Manage purchase bills, supplier companies, view inventory, and purchase reports',
      is_system: 1,
      permissions: purchaseOfficer,
    },
    {
      name: 'viewer',
      label: 'Auditor / Read-Only',
      description: 'Read-only access across transactions, reconciliation, reports, and activity logs',
      is_system: 1,
      permissions: viewer,
    },
  ];
}
