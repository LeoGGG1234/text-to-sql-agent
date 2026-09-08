import { expect, test } from '@playwright/test';

const dataSource = {
  id: 'ds-meta-1',
  name: 'orders.xlsx',
  type: 'upload',
  config: { tables: [{ name: 'ds_12345678_1234_1234_1234_123456789abc', rowCount: 2 }] },
  schemaJson: {
    tables: [{
      name: 'ds_12345678_1234_1234_1234_123456789abc',
      displayName: 'orders.xlsx',
      rowCount: 2,
      columns: [
        { name: 'customer', displayName: 'Customer', semanticType: 'TEXT', nullable: false },
        { name: 'amount', displayName: 'Amount', semanticType: 'NUMERIC', nullable: true },
      ],
    }],
    relationships: [],
    qualityProfile: {
      columns: {
        customer: { nullConvertedCount: 0, nullConvertedSamples: {}, nonMatchingCount: 0, nonMatchingRatio: 0, nonMatchingSamples: [], uniqueCount: 2, trimmedCount: 0, minLength: 1, maxLength: 1, fuzzyDuplicateClusters: 0, fuzzyDuplicateSamples: [] },
        amount: { nullConvertedCount: 1, nullConvertedSamples: { '(empty)': 1 }, nonMatchingCount: 0, nonMatchingRatio: 0, nonMatchingSamples: [], uniqueCount: 1, trimmedCount: 0, minLength: 2, maxLength: 2, fuzzyDuplicateClusters: 0, fuzzyDuplicateSamples: [] },
      },
      table: { duplicateRowCount: 0, duplicateRatio: 0, totalColumns: 2, columnsWithIssues: 1 },
    },
  },
  profileStatus: 'stale',
  profiledAt: '2026-09-08T00:00:00.000Z',
  createdAt: '2026-09-08T00:00:00.000Z',
  updatedAt: '2026-09-08T00:00:00.000Z',
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }));
  await page.route('**/api/dev-check', (route) => route.fulfill({ json: { devMode: true, guestMode: true } }));
  await page.route('**/api/conversations', (route) => route.fulfill({ json: { conversations: [] } }));
});

test('guest entry point remains available without registration', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: /体验 Demo/ })).toBeVisible();
  await expect(page.getByText('无需注册 — Demo 数据为临时保存')).toBeVisible();
});

test('an anonymous session can reach account upgrade without being redirected home', async ({ page }) => {
  await page.route('**/api/auth/**', (route) => route.fulfill({ json: {
    session: { id: 'session-guest', userId: 'guest-1', expiresAt: '2026-10-08T00:00:00.000Z' },
    user: { id: 'guest-1', name: 'Guest', email: 'guest@example.invalid', isAnonymous: true },
  } }));
  await page.goto('/login?upgrade=1');
  await expect(page.getByText('创建账号并保留当前 Demo 数据')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create Account' })).toBeVisible();
});

test('stale profile can be refreshed and cleaning requires preview before apply', async ({ page }) => {
  let applied = false;
  await page.route('**/api/data-sources', (route) => route.fulfill({ json: { dataSources: [{ ...dataSource, profileStatus: applied ? 'fresh' : 'stale' }] } }));
  await page.route('**/api/data-sources/ds-meta-1', (route) => route.fulfill({ json: { ...dataSource, profileStatus: applied ? 'fresh' : 'stale' } }));
  await page.route('**/api/data-sources/ds-meta-1/rows?**', (route) => route.fulfill({ json: {
    rows: [{ _row_id: 1, customer: ' A ', amount: '10' }, { _row_id: 2, customer: 'B', amount: null }],
    total: 2, page: 1, pageSize: 50, totalPages: 1,
    columns: [{ name: 'customer', displayName: 'Customer', semanticType: 'TEXT' }, { name: 'amount', displayName: 'Amount', semanticType: 'NUMERIC' }],
    tableName: dataSource.schemaJson.tables[0].name, tableDisplayName: 'orders.xlsx',
  } }));
  await page.route('**/api/data-sources/ds-meta-1/profile', (route) => route.fulfill({ json: { profileStatus: 'fresh' } }));
  await page.route('**/api/data-sources/ds-meta-1/cleaning-runs', (route) => route.fulfill({ json: { runs: applied ? [{ id: 'run-1', recipe: { name: 'Standard preset', steps: [] }, previewSummary: { affectedRows: 1 }, status: 'applied', createdAt: '2026-09-08T00:00:00.000Z', appliedAt: '2026-09-08T00:01:00.000Z' }] : [] } }));
  await page.route('**/api/data-sources/ds-meta-1/cleaning/preview', (route) => {
    const requestBody = route.request().postDataJSON() as { recipe?: { name: string; steps: unknown[] } };
    return route.fulfill({ json: {
      runId: 'run-1', recipe: requestBody.recipe ?? { name: 'Standard preset', steps: [{ type: 'normalize_whitespace', columns: ['customer'] }] },
      summary: { inputRows: 2, outputRows: 2, affectedRows: 1, affectedCells: 1, removedRows: 0, generatedNulls: 0, parseFailures: 1, parseFailureSamples: [{ rowId: 2, column: 'amount', value: 'bad%', reason: 'invalid_numeric' }], samples: [{ rowId: 1, column: 'customer', before: ' A ', after: 'A' }] },
    } });
  });
  await page.route('**/api/data-sources/ds-meta-1/export', (route) => route.fulfill({
    status: 200,
    contentType: 'text/csv; charset=utf-8',
    headers: { 'Content-Disposition': "attachment; filename=\"data-export.csv\"; filename*=UTF-8''orders-export.csv" },
    body: 'Customer,Amount\r\nA,10\r\n',
  }));
  await page.route('**/api/data-sources/ds-meta-1/cleaning/apply', (route) => {
    applied = true;
    return route.fulfill({ json: {
      success: true,
      beforeProfile: dataSource.schemaJson.qualityProfile,
      afterProfile: { ...dataSource.schemaJson.qualityProfile, table: { ...dataSource.schemaJson.qualityProfile.table, columnsWithIssues: 0 } },
    } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: /Data Sources/ }).click();
  await expect(page.getByText('Quality profile is stale')).toBeHidden();
  await page.getByRole('button', { name: 'Schema' }).click();
  await expect(page.getByText(/Quality profile is stale/)).toBeVisible();
  await page.getByRole('button', { name: 'View Data' }).click();
  await expect(page.getByText('profile stale')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('orders-export.csv');
  await page.getByRole('button', { name: 'Re-profile' }).click();
  await expect(page.getByText('profile fresh')).toBeVisible();
  await page.getByRole('button', { name: 'Clean Data' }).click();
  await expect(page.getByRole('button', { name: 'Apply reviewed recipe' })).toBeHidden();
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByRole('button', { name: 'Preview custom recipe' }).click();
  await expect(page.getByText('Custom policy', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'standard' }).click();
  await expect(page.getByText('Affected rows:')).toBeVisible();
  await expect(page.getByText('Unresolved parse failures')).toBeVisible();
  await expect(page.getByText('Invalid numeric value')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Apply reviewed recipe' }).click();
  await expect(page.getByText('Post-clean validation')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export applied CSV' })).toBeVisible();
  await expect(page.getByText('Standard preset')).toBeVisible();
});
