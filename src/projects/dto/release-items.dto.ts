import { ArrayNotEmpty, IsArray, IsInt } from 'class-validator';

export class ReleaseItemsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  itemIds: number[];
}
