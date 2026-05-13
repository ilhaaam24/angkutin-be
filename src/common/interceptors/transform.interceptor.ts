import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Response<T> {
  status: string;
  message: string;
  data: T;
}

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, Response<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<Response<T>> {
    return next.handle().pipe(
      map((data) => ({
        status: 'success',
        message: data?.message || 'Operation successful',
        data: this.stripSensitiveFields(data?.data !== undefined ? data.data : data),
      })),
    );
  }

  private stripSensitiveFields(data: any): any {
    if (data === null || data === undefined) return data;

    if (Array.isArray(data)) {
      return data.map((item) => this.stripSensitiveFields(item));
    }

    if (typeof data === 'object') {
      if (data instanceof Date) return data;
      
      const { password, otpCode, refreshToken, ...rest } = data;
      const stripped: any = { ...rest };
      
      for (const key in stripped) {
        if (Object.prototype.hasOwnProperty.call(stripped, key)) {
          stripped[key] = this.stripSensitiveFields(stripped[key]);
        }
      }
      return stripped;
    }

    return data;
  }
}
