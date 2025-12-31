import * as v from 'valibot';

export const errorSchema = v.object({
  error: v.string(),
});
