import { Module, Global } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { CognitoDirectoryService } from './cognito-directory.service';

@Global()
@Module({
  controllers: [UsersController],
  providers: [UsersService, CognitoDirectoryService],
  exports: [UsersService],
})
export class UsersModule {}
