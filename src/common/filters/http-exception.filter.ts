import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Unexpected server error';
    let fields: Record<string, string> = {};
    let code: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res: any = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        message = res.message || res.error || message;
        fields = res.fields || {};
        code = res.code;
        if (Array.isArray(res.message)) {
          message = res.message[0];
        }
      }
    } else if (exception && typeof exception === 'object') {
      if (exception.status && typeof exception.status === 'number') {
        status = exception.status;
      }
      if (exception.message) {
        message = exception.message;
      }
      if (exception.fields) {
        fields = exception.fields;
      }
    }

    if (status >= 500) {
      console.error('[NestJS Server Error]', exception);
    }

    const body: Record<string, unknown> = { error: message };
    if (Object.keys(fields).length) body.fields = fields;
    if (code) body.code = code;
    response.status(status).json(body);
  }
}
