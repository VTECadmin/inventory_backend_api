import { ArrayNotEmpty, IsArray } from 'class-validator';

export class ReassignDeleteDto {
  // [{ itemId, locationId }] — where each item of the deleted location should go.
  @IsArray()
  @ArrayNotEmpty()
  assignments: { itemId: number; locationId: number }[];
}
