import { Test, TestingModule } from '@nestjs/testing';
import { CouriersController } from './couriers.controller';

describe('CouriersController', () => {
  let controller: CouriersController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CouriersController],
    }).compile();

    controller = module.get<CouriersController>(CouriersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
