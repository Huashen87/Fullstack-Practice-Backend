import { Post } from '../entities/Post';
import {
  Arg,
  Ctx,
  Field,
  FieldResolver,
  InputType,
  Int,
  Mutation,
  Query,
  Resolver,
  Root,
  UseMiddleware,
} from 'type-graphql';
import { MyContext } from '../types';
import { isAuth } from '../middleware/isAuth';
import { getConnection } from 'typeorm';

@InputType()
class PostInput {
  @Field()
  title: string;
  @Field()
  text: string;
}

@Resolver(Post)
export class PostResolver {
  @FieldResolver(() => String)
  textSnippet(@Root() root: Post) {
    return root.text.slice(0, 50) + (root.text.length > 50 ? '...' : '');
  }

  @Query(() => [Post])
  async posts(
    @Arg('limit', () => Int) limit: number,
    @Arg('cursor', () => String, { nullable: true }) cursor: string | null
  ): Promise<Post[]> {
    const qb = getConnection()
      .getRepository(Post)
      .createQueryBuilder('p')
      .orderBy('"createdAt"', 'DESC')
      .take(Math.min(limit, 50));
    if (cursor) qb.where('"createdAt" < :cursor', { cursor: new Date(parseInt(cursor)) });
    return qb.getMany();
  }

  @Query(() => Post, { nullable: true })
  async post(@Arg('id', () => Int) id: number): Promise<Post | undefined> {
    return await Post.findOne(id);
  }

  @Mutation(() => Post)
  @UseMiddleware(isAuth)
  async createPost(@Arg('input') input: PostInput, @Ctx() { req }: MyContext): Promise<Post> {
    return await Post.create({ ...input, creatorId: req.session.userId }).save();
  }

  @Mutation(() => Post, { nullable: true })
  async updatePost(
    @Arg('id') id: number,
    @Arg('title', () => String, { nullable: true }) title: string
  ): Promise<Post | undefined> {
    const post = await Post.findOne(id);
    if (!post) return undefined;
    if (typeof title !== undefined) await Post.update(id, { title });
    return await Post.findOne(id);
  }

  @Mutation(() => Boolean)
  async deletePost(@Arg('id') id: number): Promise<boolean> {
    await Post.delete(id);
    return true;
  }
}
