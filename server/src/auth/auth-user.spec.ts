import { mapAuthUser, payloadToAuthUser } from './auth-user';

describe('mapAuthUser', () => {
  it('extracts email and full name from metadata', () => {
    expect(
      mapAuthUser({
        id: 'u1',
        email: 'kid@gmail.com',
        user_metadata: { full_name: 'Kid Kumar' },
      }),
    ).toEqual({ email: 'kid@gmail.com', name: 'Kid Kumar' });
  });

  it('falls back to name, then null', () => {
    expect(
      mapAuthUser({ id: 'u1', email: 'a@b.com', user_metadata: { name: 'A' } })
        .name,
    ).toBe('A');
    expect(mapAuthUser({ id: 'u1', email: 'a@b.com' }).name).toBeNull();
  });

  it('lowercases the email', () => {
    expect(mapAuthUser({ id: 'u1', email: 'Kid@Gmail.COM' }).email).toBe(
      'kid@gmail.com',
    );
  });

  it('throws when the auth user has no email', () => {
    expect(() => mapAuthUser({ id: 'u1' })).toThrow(/email/i);
  });
});

describe('payloadToAuthUser', () => {
  it('maps sub/email/user_metadata claims', () => {
    expect(
      payloadToAuthUser({
        sub: 'uuid-1',
        email: 'a@b.com',
        user_metadata: { full_name: 'A B' },
      }),
    ).toEqual({
      id: 'uuid-1',
      email: 'a@b.com',
      user_metadata: { full_name: 'A B' },
    });
  });

  it('throws when sub is missing', () => {
    expect(() => payloadToAuthUser({ email: 'a@b.com' })).toThrow(/sub/i);
  });
});
