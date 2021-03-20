import { User } from '../entities/User';
import { MyContext } from 'src/types';
import { Arg, Ctx, Field, InputType, Mutation, ObjectType, Query, Resolver } from 'type-graphql';
import argon2 from 'argon2';
import 'express-session';
import { COOKIE_NAME } from '../constants';

declare module 'express-session' {
  interface SessionData {
    userId?: number;
  }
}

@InputType()
class UsernamePasswordInput {
  @Field()
  username: string;
  @Field()
  password: string;
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
  async me(@Ctx() { req, em }: MyContext) {
    if (!req.session.userId) return null;
    return await em.findOne(User, { id: req.session.userId });
  }

  @Query(() => [User])
  async users(@Ctx() { em }: MyContext) {
    const users = await em.find(User, {});
    return users;
  }
  @Mutation(() => UserResponse)
  async register(@Arg('options') options: UsernamePasswordInput, @Ctx() { req, em }: MyContext) {
    if (options.username.length < 3) return { errors: [{ field: 'username', message: 'length must be at least 3' }] };
    if (options.password.length < 6) return { errors: [{ field: 'password', message: 'length must be at least 6' }] };
    const hashedPassword = await argon2.hash(options.password);
    const user = em.create(User, { username: options.username, password: hashedPassword });
    try {
      await em.persistAndFlush(user);
    } catch (err) {
      if (err.code === '23505') return { errors: [{ field: 'username', message: 'username already taken' }] };
    }
    req.session.userId = user.id;
    return { user: user };
  }

  @Mutation(() => UserResponse)
  async login(@Arg('options') options: UsernamePasswordInput, @Ctx() { em, req }: MyContext): Promise<UserResponse> {
    const user = await em.findOne(User, { username: options.username });
    if (!user) return { errors: [{ field: 'username', message: "that username doesn't exist" }] };
    const valid = await argon2.verify(user.password, options.password);
    if (!valid) return { errors: [{ field: 'password', message: 'incorrect password' }] };
    req.session.userId = user.id;
    return { user: user };
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
}
