import { UserInput } from '../UserInput';

export const validateRegister = (options: UserInput) => {
  if (options.username.length < 3)
    return [{ field: 'username', message: 'length must be at least 3' }];
  if (options.username.includes('@'))
    return [{ field: 'username', message: 'cannot include an @' }];
  if (!options.email.includes('@')) return [{ field: 'email', message: 'invalid email' }];
  if (options.password.length < 6)
    return [{ field: 'password', message: 'length must be at least 6' }];
  return null;
};
