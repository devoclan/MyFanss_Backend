import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { RefreshToken } from '../../src/auth/entities/refresh-token.entity';
import { AuditLog } from '../../src/audit/audit.entity';
import { GlobalExceptionFilter } from '../../src/exception/globalException.filter';
import { User } from '../../src/users/user.entity';

export interface E2eTestApp {
  app: INestApplication;
  moduleFixture: TestingModule;
  dataSource: DataSource;
  userRepository: Repository<User>;
  refreshTokenRepository: Repository<RefreshToken>;
  auditLogRepository: Repository<AuditLog>;
}

export async function createE2eApp(): Promise<E2eTestApp> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();

  return {
    app,
    moduleFixture,
    dataSource: moduleFixture.get(DataSource),
    userRepository: moduleFixture.get<Repository<User>>(
      getRepositoryToken(User),
    ),
    refreshTokenRepository: moduleFixture.get<Repository<RefreshToken>>(
      getRepositoryToken(RefreshToken),
    ),
    auditLogRepository: moduleFixture.get<Repository<AuditLog>>(
      getRepositoryToken(AuditLog),
    ),
  };
}

/** @deprecated Use createE2eApp() — kept for older e2e specs */
export async function createTestingApp(): Promise<INestApplication> {
  const testApp = await createE2eApp();
  return testApp.app;
}

export async function clearDatabase(dataSource: DataSource): Promise<void> {
  await dataSource.query('TRUNCATE TABLE "comments" RESTART IDENTITY CASCADE');
  await dataSource.query(
    'TRUNCATE TABLE "content_reports" RESTART IDENTITY CASCADE',
  );
  await dataSource.query(
    'TRUNCATE TABLE "audit_logs" RESTART IDENTITY CASCADE',
  );
  await dataSource.query('TRUNCATE TABLE "users" RESTART IDENTITY CASCADE');
}
