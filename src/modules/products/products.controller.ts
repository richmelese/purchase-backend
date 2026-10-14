import { Controller, Get, Post, Put, Delete, Body, Param, HttpCode } from '@nestjs/common';
import { ProductsService } from './products.service.js';
import { Permission } from '../../common/decorators/permission.decorator.js';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Permission(['products', 'view'], ['purchases', 'create'], ['purchases', 'edit'], ['sales', 'create'], ['sales', 'edit'], ['inventory', 'view'], ['inventory', 'create'])
  @Get()
  async list() {
    return this.productsService.stockReport();
  }

  @Permission(['products', 'create'])
  @Get('next-code')
  async getNextCode() {
    const code = await this.productsService.nextProductCode();
    return { code };
  }

  @Permission(['products', 'view'], ['inventory', 'view'])
  @Get(':id/movements')
  async getMovements(@Param('id') id: string) {
    return this.productsService.getMovements(+id);
  }

  @Permission(['products', 'create'])
  @Post()
  async create(@Body() body: any) {
    return this.productsService.create(body);
  }

  @Permission(['products', 'edit'])
  @Put(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    return this.productsService.update(+id, body);
  }

  @Permission(['products', 'delete'])
  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id') id: string) {
    await this.productsService.delete(+id);
  }
}
