import { IsInt, Min } from 'class-validator';

export class AssignProjectDto {
  @IsInt()
  @Min(1)
  projectId: number;
}
