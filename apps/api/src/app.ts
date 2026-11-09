import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { CONTROLLERS } from "./controllers.js";
import { ApiExceptionFilter } from "./http.js";
import { RUNTIME, type Runtime } from "./runtime.js";

export async function createApp(rt: Runtime): Promise<INestApplication> {
  @Module({ controllers: CONTROLLERS, providers: [{ provide: RUNTIME, useValue: rt }] })
  class AppModule {}
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableCors({
    origin: process.env["WEB_ORIGIN"] ?? true,
    allowedHeaders: ["content-type", "authorization", "x-correlation-id", "x-agent-token"],
  });
  return app;
}
