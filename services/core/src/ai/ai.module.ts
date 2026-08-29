import { Global, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AiModelEntity, AiProviderEntity, AiProviderKeyEntity } from "../database/entities";
import { AiController } from "./ai.controller";
import { AiRegistryService } from "./ai-registry.service";

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AiProviderEntity, AiProviderKeyEntity, AiModelEntity])],
  controllers: [AiController],
  providers: [AiRegistryService],
  exports: [AiRegistryService],
})
export class AiModule {}
