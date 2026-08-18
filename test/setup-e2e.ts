// Point the e2e run at the isolated test database (see database/create.sql
// and the seeding in learning/steps/etape-18-tests.md).
process.env.DB_NAME = process.env.DB_NAME ?? 'vtec_dashboard_test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';
