import { User } from '../entities/User';
import { MyContext } from '../types';
import { Arg, Ctx, Field, Mutation, ObjectType, Query, Resolver } from 'type-graphql';
import argon2 from 'argon2';
import 'express-session';
import { COOKIE_NAME, FORGET_PASSWORD_PREFIX } from '../constants';
import { sendEmail } from './utils/sendEmail';
import { UserInput } from './UserInput';
import { validateRegister } from './utils/validateRegister';
import { v4 } from 'uuid';
import { sleep } from './utils/sleep';

declare module 'express-session' {
  interface SessionData {
    userId?: number;
  }
}

@ObjectType()
class FieldError {
  @Field()
  field: string;
  @Field()
  message: string;
}

@ObjectType()
class UserResponse {
  @Field(() => [FieldError], { nullable: true })
  errors?: FieldError[];
  @Field(() => User, { nullable: true })
  user?: User;
}

@Resolver()
export class UserResolver {
  @Query(() => User, { nullable: true })
  me(@Ctx() { req }: MyContext) {
    if (!req.session.userId) return null;
    return User.findOne(req.session.userId);
  }

  @Query(() => [User])
  users() {
    return User.find();
  }

  @Mutation(() => UserResponse)
  async register(@Arg('options') options: UserInput, @Ctx() { req }: MyContext) {
    const errors = validateRegister(options);
    if (errors) return { errors };
    const hashedPassword = await argon2.hash(options.password);
    let user;
    try {
      user = await User.create({
        username: options.username,
        password: hashedPassword,
        email: options.email,
      }).save();

      // Or using query builder

      // const result = await getConnection()
      //   .createQueryBuilder()
      //   .insert()
      //   .into(User)
      //   .values({
      //     username: options.username,
      //     password: hashedPassword,
      //     email: options.email,
      //   })
      //   .returning('*')
      //   .execute();
      // user = result.raw[0];
    } catch (err) {
      if (err.code === '23505')
        return {
          errors: [{ field: 'usernameOrEmail', message: 'username or email already taken' }],
        };
    }
    req.session.userId = user?.id;
    return { user };
  }

  @Mutation(() => UserResponse)
  async login(
    @Arg('usernameOrEmail') usernameOrEmail: string,
    @Arg('password') password: string,
    @Ctx() { req }: MyContext
  ): Promise<UserResponse> {
    const user = await User.findOne(
      usernameOrEmail.includes('@') ? { email: usernameOrEmail } : { username: usernameOrEmail }
    );
    if (!user)
      return {
        errors: [
          {
            field: 'usernameOrEmail',
            message: `that ${usernameOrEmail.includes('@') ? 'email' : 'username'} doesn't exist`,
          },
        ],
      };
    const valid = await argon2.verify(user.password, password);
    if (!valid) return { errors: [{ field: 'password', message: 'incorrect password' }] };
    req.session.userId = user.id;
    return { user };
  }

  @Mutation(() => Boolean)
  logout(@Ctx() { req, res }: MyContext) {
    return new Promise((resolve) =>
      req.session.destroy((err) => {
        res.clearCookie(COOKIE_NAME);
        if (err) {
          console.error(err.message);
          resolve(false);
          return;
        }
        resolve(true);
      })
    );
  }

  @Mutation(() => Boolean)
  async forgotPassword(@Arg('email') email: string, @Ctx() { redis }: MyContext): Promise<boolean> {
    const user = await User.findOne({ email });
    if (!user) {
      await sleep(5000);
      return true;
    }
    const token = v4();
    await redis.set(FORGET_PASSWORD_PREFIX + token, user.id, 'ex', 1000 * 60 * 10);
    await sendEmail(
      email,
      `<h2>Hi ${user.username}.</h2>
      <p>Please click the link below to reset your password!</p>
      <a href="http://localhost:3000/reset-password/${token}">Reset Your Password</a>`
    );
    return true;
  }

  @Mutation(() => UserResponse)
  async resetPassword(
    @Arg('token') token: string,
    @Arg('newPassword') newPassword: string,
    @Arg('confirmPassword') confirmPassword: string,
    @Ctx() { redis, req }: MyContext
  ) {
    if (newPassword.length < 6)
      return { errors: [{ field: 'newPassword', message: 'length must be at least 6' }] };
    if (confirmPassword !== newPassword)
      return { errors: [{ field: 'confirmPassword', message: 'password not match' }] };

    const key = FORGET_PASSWORD_PREFIX + token;
    const userId = await redis.get(key);
    if (!userId) return { errors: [{ field: 'token', message: 'token expired' }] };

    const userIdNum = parseInt(userId);
    const user = await User.findOne(userIdNum);
    if (!user) return { errors: [{ field: 'token', message: 'user no longer exists' }] };

    await User.update(userIdNum, { password: await argon2.hash(newPassword) });

    req.session.userId = user.id;
    await redis.del(key);

    return { user };
  }
}
