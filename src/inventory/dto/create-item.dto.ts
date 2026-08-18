import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateItemDto {
  @IsString()
  @MinLength(1)
  description: string;

  // Locations are managed data now (find-or-create by name), not a fixed set.
  @IsString()
  @MinLength(1)
  location: string;

  @IsOptional()
  @IsInt()
  category_id?: number;

  // A new category name to find-or-create (used instead of category_id).
  @IsOptional()
  @IsString()
  categoryName?: string;

  @IsOptional()
  @IsString()
  sub_location?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  qty_found?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  qty_needed?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  qty_available?: number;

  // Alert when qty_available drops to this value or below. Null → alert only when out of stock.
  @IsOptional()
  @IsInt()
  @Min(0)
  low_stock_threshold?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  // ── Optional equipment-registry details ──
  @IsOptional() @IsString() serial_number?: string;
  @IsOptional() @IsString() manufacturer?: string;
  @IsOptional() @IsString() manufacturer_contact?: string;
  @IsOptional() @IsString() owner?: string;
  @IsOptional() @IsString() device_status?: string;
  @IsOptional() @IsBoolean() label_printed?: boolean;
  @IsOptional() @IsBoolean() calibration_required?: boolean;
  @IsOptional() @IsString() calibration_method?: string;
  @IsOptional() @IsDateString() maintenance_next?: string;
  @IsOptional() @IsDateString() maintenance_last?: string;
  @IsOptional() @IsInt() @Min(0) maintenance_freq_months?: number;
  // Reminder threshold: flag "calibration due" when maintenance_next is within this much time.
  @IsOptional() @IsInt() @Min(0) calibration_alert_value?: number;
  @IsOptional() @IsIn(['days', 'months']) calibration_alert_unit?: 'days' | 'months';
  @IsOptional() @IsString() service_provider?: string;
  @IsOptional() @IsString() service_provider_contact?: string;
  @IsOptional() @IsBoolean() training_required?: boolean;
  @IsOptional() @IsString() training_material?: string;
  @IsOptional() @IsString() trainer?: string;
  @IsOptional() @IsDateString() date_of_purchase?: string;
  @IsOptional() @IsDateString() date_in_service?: string;
}
