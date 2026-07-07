import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy } from 'passport-google-oauth20';
import type { AuthUserLike } from './auth-user';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor() {
    super({
      // 'unconfigured' lets the app boot without credentials (sign-in fails
      // at Google's door until Task 0 fills server/.env)
      clientID: process.env.GOOGLE_CLIENT_ID ?? 'unconfigured',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? 'unconfigured',
      callbackURL:
        process.env.GOOGLE_CALLBACK_URL ??
        'http://localhost:3001/auth/google/callback',
      scope: ['openid', 'email', 'profile'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
  ): AuthUserLike {
    return {
      id: profile.id,
      email: profile.emails?.[0]?.value ?? null,
      user_metadata: { full_name: profile.displayName },
    };
  }
}
