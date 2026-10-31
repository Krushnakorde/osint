// Train (or retrain) the AI domain classifier.
// Usage: npm run train                 -> real labels: blocklisted domains in the database + benign list
//        npm run train -- synthetic    -> clearly-labelled demo model
import { boot } from './_context.ts';

const provider = process.argv[2] ?? 'graph';
const { services, close } = await boot();
const info = await services.models.train(provider);
console.log(`Trained model v${info.version} on "${info.trainedOn.source}" (${info.trainedOn.positives} fraud, ${info.trainedOn.negatives} benign)`);
console.log('Train :', info.metrics.train);
console.log('Test  :', info.metrics.test, '\n(only the TEST numbers say how well it generalises)');
await close();
