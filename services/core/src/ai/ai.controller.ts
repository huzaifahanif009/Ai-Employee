import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString } from "class-validator";
import { Ctx, RequireCapability } from "../common/decorators";
import { RequestContext } from "../common/request-context";
import { AiRegistryService } from "./ai-registry.service";

class CreateProviderDto {
  @IsString() kind!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() baseUrl?: string;
  @IsOptional() config?: Record<string, unknown>;
  @IsOptional() @IsBoolean() seedModels?: boolean;
}
class UpdateProviderDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() baseUrl?: string | null;
  @IsOptional() config?: Record<string, unknown>;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}
class AddKeyDto {
  @IsString() label!: string;
  @IsString() apiKey!: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}
class UpdateKeyDto {
  @IsOptional() @IsString() label?: string;
  @IsOptional() @IsString() apiKey?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}
class ModelDto {
  @IsOptional() @IsString() providerId?: string;
  @IsOptional() @IsString() alias?: string;
  @IsOptional() @IsString() providerModel?: string;
  @IsOptional() @IsArray() routingClasses?: string[];
  @IsOptional() @IsArray() capabilities?: string[];
  @IsOptional() @IsInt() contextWindow?: number;
  @IsOptional() @IsInt() maxOutput?: number;
  @IsOptional() @IsNumber() priceInputPerMTok?: number;
  @IsOptional() @IsNumber() priceOutputPerMTok?: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

@ApiTags("ai")
@Controller("ai")
export class AiController {
  constructor(private readonly ai: AiRegistryService) {}

  @Get("provider-kinds")
  kinds() {
    return this.ai.supportedKinds();
  }

  @Get("providers")
  listProviders(@Ctx() ctx: RequestContext) {
    return this.ai.listProviders(ctx.tenantId);
  }

  @Post("providers")
  @RequireCapability("provider:write")
  createProvider(@Ctx() ctx: RequestContext, @Body() dto: CreateProviderDto) {
    return this.ai.createProvider(ctx.tenantId, dto as never);
  }

  @Patch("providers/:id")
  @RequireCapability("provider:write")
  updateProvider(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() dto: UpdateProviderDto) {
    return this.ai.updateProvider(ctx.tenantId, id, dto);
  }

  @Delete("providers/:id")
  @RequireCapability("provider:write")
  deleteProvider(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.ai.deleteProvider(ctx.tenantId, id);
  }

  @Post("providers/:id/seed-models")
  @RequireCapability("provider:write")
  async seed(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    await this.ai.seedDefaultModels(ctx.tenantId, id);
    return { ok: true };
  }

  @Get("providers/:id/discover-models")
  discover(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.ai.listProviderModelIds(ctx.tenantId, id);
  }

  // keys
  @Post("providers/:id/keys")
  @RequireCapability("provider:write")
  addKey(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() dto: AddKeyDto) {
    return this.ai.addKey(ctx.tenantId, id, dto);
  }

  @Patch("keys/:keyId")
  @RequireCapability("provider:write")
  updateKey(@Ctx() ctx: RequestContext, @Param("keyId") keyId: string, @Body() dto: UpdateKeyDto) {
    return this.ai.updateKey(ctx.tenantId, keyId, dto);
  }

  @Delete("keys/:keyId")
  @RequireCapability("provider:write")
  deleteKey(@Ctx() ctx: RequestContext, @Param("keyId") keyId: string) {
    return this.ai.deleteKey(ctx.tenantId, keyId);
  }

  @Post("keys/:keyId/test")
  @RequireCapability("provider:write")
  testKey(@Ctx() ctx: RequestContext, @Param("keyId") keyId: string) {
    return this.ai.testKey(ctx.tenantId, keyId);
  }

  // models
  @Get("models")
  listModels(@Ctx() ctx: RequestContext) {
    return this.ai.listModels(ctx.tenantId);
  }

  @Post("models")
  @RequireCapability("provider:write")
  createModel(@Ctx() ctx: RequestContext, @Body() dto: ModelDto) {
    return this.ai.createModel(ctx.tenantId, dto as never);
  }

  @Patch("models/:id")
  @RequireCapability("provider:write")
  updateModel(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() dto: ModelDto) {
    return this.ai.updateModel(ctx.tenantId, id, dto);
  }

  @Delete("models/:id")
  @RequireCapability("provider:write")
  deleteModel(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.ai.deleteModel(ctx.tenantId, id);
  }
}
