import {
  Controller,
  Get,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PlansService } from './plans.service';
import { PlanResponseDto } from './dto/plan-response.dto';
import { ListPlansQueryDto } from './dto/list-plans.query.dto';

@ApiTags('Plans')
@Controller('plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Get()
  @ApiOperation({
    summary: 'List active plans — public; optional filters by category, niche, tier',
  })
  findAll(@Query() query: ListPlansQueryDto): Promise<PlanResponseDto[]> {
    return this.plansService.findAll({
      category: query.category,
      niche: query.niche,
      tier: query.tier,
    });
  }
}
