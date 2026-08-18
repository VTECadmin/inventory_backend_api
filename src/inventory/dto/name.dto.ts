import { IsString, MinLength } from 'class-validator';

export class NameDto {
  @IsString()
  @MinLength(1)
  name: string;
}
