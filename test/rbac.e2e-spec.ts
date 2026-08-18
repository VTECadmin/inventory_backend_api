import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';

/**
 * RBAC matrix: for each role, hit each protected endpoint and assert the right
 * outcome (allowed vs 403). This proves the access rules hold at the API level,
 * not just in the UI — which is the core of the project.
 */
describe('RBAC matrix (e2e)', () => {
  let app: INestApplication;
  const tokens: Record<string, string> = {};
  const userIds: Record<string, number> = {};
  const s = Date.now(); // unique suffix so created names never clash

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }),
    );
    await app.init();

    for (const role of ['admin', 'manager', 'employee']) {
      const { body } = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: `${role}@vtec.com`, password: 'password123' });
      tokens[role] = body.access_token;
      userIds[role] = body.user.id;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  // Fires a request as a given role.
  const call = (role: string, method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: any) => {
    const r = (request(app.getHttpServer()) as any)[method](path).set('Authorization', `Bearer ${tokens[role]}`);
    return body ? r.send(body) : r;
  };

  describe('read the inventory (GET /inventory)', () => {
    it('employee → 200', () => call('employee', 'get', '/inventory').expect(200));
    it('manager → 200', () => call('manager', 'get', '/inventory').expect(200));
    it('admin → 200', () => call('admin', 'get', '/inventory').expect(200));
  });

  describe('create an item (POST /inventory)', () => {
    it('employee → 403', () => call('employee', 'post', '/inventory', { description: `E ${s}`, location: 'Lab 01' }).expect(403));
    it('manager → 201', () => call('manager', 'post', '/inventory', { description: `Item M ${s}`, location: 'Lab 01' }).expect(201));
    it('admin → 201', () => call('admin', 'post', '/inventory', { description: `Item A ${s}`, location: 'Lab 01' }).expect(201));
  });

  describe('export the inventory (GET /inventory/export)', () => {
    it('employee → 403', () => call('employee', 'get', '/inventory/export').expect(403));
    it('manager → 200', () => call('manager', 'get', '/inventory/export').expect(200));
    it('admin → 200', () => call('admin', 'get', '/inventory/export').expect(200));
  });

  describe('manage lists — create a location (POST /inventory/locations)', () => {
    it('employee → 403', () => call('employee', 'post', '/inventory/locations', { name: `Loc E ${s}` }).expect(403));
    it('manager → 201', () => call('manager', 'post', '/inventory/locations', { name: `Loc M ${s}` }).expect(201));
  });

  describe('manage lists — create a category (POST /inventory/categories)', () => {
    it('employee → 403', () => call('employee', 'post', '/inventory/categories', { name: `Cat E ${s}` }).expect(403));
    it('admin → 201', () => call('admin', 'post', '/inventory/categories', { name: `Cat A ${s}` }).expect(201));
  });

  describe('projects — create (POST /projects)', () => {
    it('employee → 403', () => call('employee', 'post', '/projects', { name: `Proj E ${s}` }).expect(403));
    it('manager → 201', () => call('manager', 'post', '/projects', { name: `Proj M ${s}` }).expect(201));
  });

  describe('projects — list (GET /projects)', () => {
    it('employee → 200', () => call('employee', 'get', '/projects').expect(200));
    it('manager → 200', () => call('manager', 'get', '/projects').expect(200));
  });

  describe('user management — list users (GET /users)', () => {
    it('employee → 403', () => call('employee', 'get', '/users').expect(403));
    it('manager → 403', () => call('manager', 'get', '/users').expect(403));
    it('admin → 200', () => call('admin', 'get', '/users').expect(200));
  });

  describe('directory readable by everyone (GET /users/directory)', () => {
    it('employee → 200', () => call('employee', 'get', '/users/directory').expect(200));
    it('manager → 200', () => call('manager', 'get', '/users/directory').expect(200));
    it('admin → 200', () => call('admin', 'get', '/users/directory').expect(200));
  });

  describe('change a role (PATCH /users/:id/role)', () => {
    it('employee → 403', () => call('employee', 'patch', `/users/${userIds.employee}/role`, { role: 'employee' }).expect(403));
    it('manager → 403', () => call('manager', 'patch', `/users/${userIds.employee}/role`, { role: 'employee' }).expect(403));
    it('admin → 200', () => call('admin', 'patch', `/users/${userIds.employee}/role`, { role: 'employee' }).expect(200));
  });

  describe("a user's holdings — admin only (GET /transactions/holdings/:id)", () => {
    it('admin → 200', () => call('admin', 'get', `/transactions/holdings/${userIds.employee}`).expect(200));
    it('manager → 403', () => call('manager', 'get', `/transactions/holdings/${userIds.employee}`).expect(403));
    it('employee → 403', () => call('employee', 'get', `/transactions/holdings/${userIds.employee}`).expect(403));
  });

  describe('history readable by everyone (GET /transactions)', () => {
    it('employee → 200', () => call('employee', 'get', '/transactions').expect(200));
    it('manager → 200', () => call('manager', 'get', '/transactions').expect(200));
    it('admin → 200', () => call('admin', 'get', '/transactions').expect(200));
  });

  describe('no token is rejected (401)', () => {
    it('GET /inventory → 401', () => request(app.getHttpServer()).get('/inventory').expect(401));
    it('GET /projects → 401', () => request(app.getHttpServer()).get('/projects').expect(401));
    it('GET /users → 401', () => request(app.getHttpServer()).get('/users').expect(401));
  });
});
