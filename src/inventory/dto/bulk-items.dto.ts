import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsInt, Min } from 'class-validator';

// Upper bound on a single bulk operation, so an oversized payload can't build a
// huge query. Comfortably above any realistic selection.
const MAX_BULK_ITEMS = 500;

export class BulkItemsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_BULK_ITEMS)
  @IsInt({ each: true })
  @Min(1, { each: true })
  itemIds!: number[];
}

export class BulkAssignProjectDto extends BulkItemsDto {
  @IsInt()
  @Min(1)
  projectId!: number;
}
