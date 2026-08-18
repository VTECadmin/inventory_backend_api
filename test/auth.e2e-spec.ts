import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';

describe('Auth & RBAC (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const login = (email: string) =>
    request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password123' });

  it('logs in with valid credentials and returns a token', async () => {
    const res = await login('admin@vtec.com').expect(201);
    expect(res.body.access_token).toBeDefined();
    expect(res.body.user).toMatchObject({ email: 'admin@vtec.com', role: 'admin' });
  });

  it('rejects a wrong password with 401', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@vtec.com', password: 'wrongpassword' })
      .expect(401);
  });

  it('rejects an invalid email format with 400', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'not-an-email', password: 'password123' })
      .expect(400);
  });

  it('blocks /inventory without a token (401)', async () => {
    await request(app.getHttpServer()).get('/inventory').expect(401);
  });

  it('allows /inventory with a valid token (200)', async () => {
    const { body } = await login('employee@vtec.com');
    await request(app.getHttpServer())
      .get('/inventory')
      .set('Authorization', `Bearer ${body.access_token}`)
      .expect(200);
  });

  it('forbids CSV export for an employee (403)', async () => {
    const { body } = await login('employee@vtec.com');
    await request(app.getHttpServer())
      .get('/inventory/export')
      .set('Authorization', `Bearer ${body.access_token}`)
      .expect(403);
  });

  it('allows CSV export for an admin (200)', async () => {
    const { body } = await login('admin@vtec.com');
    await request(app.getHttpServer())
      .get('/inventory/export')
      .set('Authorization', `Bearer ${body.access_token}`)
      .expect(200);
  });

  it('forbids item creation for an employee (403)', async () => {
    const { body } = await login('employee@vtec.com');
    await request(app.getHttpServer())
      .post('/inventory')
      .set('Authorization', `Bearer ${body.access_token}`)
      .send({ description: 'Nope', location: 'Lab 01' })
      .expect(403);
  });
});
