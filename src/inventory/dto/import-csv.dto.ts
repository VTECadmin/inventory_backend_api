import { IsString, MinLength } from 'class-validator';

export class ImportCsvDto {
  @IsString()
  @MinLength(1)
  csv: string;
}
