import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { IsObject, IsOptional, IsString } from "class-validator";
import { Ctx, RequireCapability } from "../common/decorators";
import { RequestContext } from "../common/request-context";
import { ConnectorsService } from "./connectors.service";

class CreateConnectorDto {
  @IsString() kind!: "gitlab" | "github" | "bitbucket" | "generic-git";
  @IsString() name!: string;
  @IsObject() config!: Record<string, unknown>;
  @IsString() token!: string;
  @IsOptional() @IsString() webhookSecret?: string;
}
class UpdateConnectorDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsObject() config?: Record<string, unknown>;
  @IsOptional() @IsString() token?: string;
  @IsOptional() @IsString() webhookSecret?: string;
}

@ApiTags("connectors")
@Controller("connectors")
export class ConnectorsController {
  constructor(private readonly connectors: ConnectorsService) {}

  @Get()
  list(@Ctx() ctx: RequestContext) {
    return this.connectors.list(ctx.tenantId);
  }

  @Post()
  @RequireCapability("connector:write")
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateConnectorDto) {
    return this.connectors.create(ctx.tenantId, dto);
  }

  @Patch(":id")
  @RequireCapability("connector:write")
  update(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() dto: UpdateConnectorDto) {
    return this.connectors.update(ctx.tenantId, id, dto);
  }

  @Delete(":id")
  @RequireCapability("connector:write")
  remove(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.connectors.remove(ctx.tenantId, id);
  }

  @Post(":id/test")
  test(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.connectors.test(ctx.tenantId, id);
  }

  /** Generate a new inbound-webhook secret. Returns the plaintext once — copy it into GitHub/GitLab now. */
  @Post(":id/webhook-secret")
  @RequireCapability("connector:write")
  rotateWebhookSecret(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.connectors.rotateWebhookSecret(ctx.tenantId, id);
  }

  @Get(":id/repos")
  repos(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.connectors.listRepos(ctx.tenantId, id);
  }
}
