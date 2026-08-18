import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ItemActionDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  qty?: number = 1;

  @IsOptional()
  @IsString()
  notes?: string;

  // Target a specific borrow (used by "My Borrows"); otherwise the most recent.
  @IsOptional()
  @IsInt()
  @Min(1)
  borrowId?: number;
}
