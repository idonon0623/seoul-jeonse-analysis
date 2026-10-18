import {handleRent} from '../../lib/seoul.mjs';

export const onRequest = context => handleRent(context.request, context.env, context);
