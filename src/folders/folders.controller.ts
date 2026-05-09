import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req } from '@nestjs/common';
import { FoldersService } from './folders.service';
import { CreateFolderDto } from './dto/create-folder.dto';
import { UpdateFolderDto } from './dto/update-folder.dto';
import { AdminGuard } from '../admin-auth/guards/admin.guard';
import { Request } from 'express';

@UseGuards(AdminGuard)
@Controller('folders')
export class FoldersController {
  constructor(private readonly foldersService: FoldersService) {}

  @Post()
  create(@Req() req: any, @Body() createFolderDto: CreateFolderDto) {
    const adminId = req.user.id;
    return this.foldersService.create(adminId, createFolderDto);
  }

  @Get('tree')
  getTree() {
    return this.foldersService.getFolderTree();
  }

  @Get()
  findAll() {
    return this.foldersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.foldersService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateFolderDto: UpdateFolderDto) {
    return this.foldersService.update(id, updateFolderDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.foldersService.remove(id);
  }
}
