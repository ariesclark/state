import { objects } from "@ariesclark/utils"
import { Keys, OmitByType } from "@ariesclark/utils/dist/objects";

/* eslint-disable @typescript-eslint/no-non-null-assertion */

export type ObservableValue = string | number;
export interface ObservableObject { [K: string]: ObservableValue }
export interface DeepObservableObject { [K: string]: ObservableObject | ObservableValue }

export interface ObservableSubscribeCallbackContext <T, K extends Keys<T>> {
	/**
	 * The current value.
	 */
	value: T[K],
	/**
	 * The previous value.
	 */
	previousValue: T[K],
	/**
	 * The key on the state object.
	 */
	path: K
}

/**
 * @param context {@link ObservableSubscribeCallbackContext}
 */
export type ObservableSubscribeCallback <T, K extends Keys<T>> = (context: ObservableSubscribeCallbackContext<T, K>) => void;

export interface ObservableSubscribeOptions {
	/** 
	 * Remove the subscriber when called.
	 */
	once?: boolean,
	/**
	 * Immediately invoke the subscriber with the current values.
	 */
	immediate?: boolean
}

export interface ObservableSubscribeReturn {
	/**
	 * Remove this subscriber.
	 */
	unsubscribe: () => void
}

export interface ComputeCallbackContext <T> {
	/**
	 * The current state.
	 */
	value: T
}

/**
 * @param context {@link ComputeCallbackContext}
 */
export type ComputeCallback <T, K extends Keys<T>> = (context: ComputeCallbackContext<T>) => T[K];

export interface ComputeDeclaration <T, K extends Keys<T>> {
	/**
	 * The compute callback.
	 * @see {@link ComputeCallback}
	 */
	execute: ComputeCallback<T, K>,
	/**
	 * An array of keys which, when they change, 
	 * will execute the callback and update the computed value.
	 */
	dependencies: (Exclude<Keys<T>, K>)[]
}

/**
 * An object of keys which will be handled by their 
 * respective computation declaration.
 */
export type ComputeMapDeclaration <T> = {
	[K in Keys<T>]?: ComputeDeclaration<T, K>
}

const valueSymbol = Symbol("value");
const subscribersSymbol = Symbol("subscribers");
const nullSubscriberSymbol = Symbol("null subscriber");
const computesSymbol = Symbol("computes");

/**
 * The default subscriber options.
 * @see {@link ObservableSubscribeOptions}
 */
export const ObservableSubscribeOptionsDefaults = Object.freeze(Object.seal<Required<ObservableSubscribeOptions>>({
	once: false,
	immediate: false
}));

/**
 * An observable object.
 */
export interface Observable <T> {
	/** The current state */
	current: T,
	[valueSymbol]: T,
	[computesSymbol]: { [K in Keys<T>]?: ComputeDeclaration<T, K> },
	[subscribersSymbol]: { [K in Keys<T> | typeof nullSubscriberSymbol]?: ObservableSubscribeCallback<T, Keys<T>>[] }
	/**
	 * Subscribe to state changes.
	 * @param input A specific key, an array of keys or `null` for every key.
	 * @param callback A function to listen to the changes.
	 * @param options see {@link ObservableSubscribeOptions}
	 */
	subscribe <
		K extends Keys<OmitByType<T, object>>, 
		I extends (K | Array<K> | null)
	> (
		input: I, 
		callback: ObservableSubscribeCallback<T, K>, 
		options?: ObservableSubscribeOptions
	): ObservableSubscribeReturn,
	/**
	 * Remove an existing subscriber, this will prevent it from receiving new changes.
	 * @param input A specific key, an array of keys or `null` for every key.
	 * @param callback The subscriber function to remove.
	 */
	unsubscribe: <
		K extends Keys<OmitByType<T, object>>, 
		I extends (K | Array<K> | null)> (
		input: I, 
		callback: ObservableSubscribeCallback<T, never>
	) => void,
	compute: (declaration: ComputeMapDeclaration<T>) => void,
}

/**
 * A deeply nested observable object.
 * Nested objects are given their own respective observable.
 */
export type DeepObservable <T> = Observable<{ [K in Keys<T>]: T[K] extends object ? Observable<T[K]> : T[K] }>; 

/**
 * Create and observe an object.
 * @param initialObject The initial state.
 * @param computeDeclaration An object of keys which will be handled by their respective computation declaration.
 * @returns see {@link DeepObservable}
 */
export const observe = <T extends ObservableObject> (
	initialObject: T, 
	computeDeclaration: ComputeMapDeclaration<T> = {}
): DeepObservable<T> => {
	const initialValues = objects.filter<T, OmitByType<T, object>>(initialObject, (key, value) => typeof value !== "object");
	const values = objects.create<DeepObservable<T>[typeof valueSymbol]>(initialValues as any);
	const computes = objects.create<Observable<T>[typeof computesSymbol]>();
	const subscribers = objects.create<Observable<T>[typeof subscribersSymbol]>();

	const store = objects.create<any>();

	for (const path of objects.keys(initialObject)) {
		if (typeof initialObject[path] === "object") {
			store[path] = observe(initialObject[path] as any);
			continue;
		}

		Object.defineProperty(store, path, {
			get: () => values[path],
			set: (value: T[Keys<T>]) => {
				const context = objects.create<any>({
					path,
					previousValue: values[path],
					value
				});

				values[path] = value as any;
				
				subscribers[path]?.forEach((callback) => callback(context));
				subscribers[nullSubscriberSymbol]?.forEach((callback) => callback(context));
			}
		});
	}

	const unsubscribe: Observable<T>["unsubscribe"] = (input, callback) => {
		const paths = ((Array.isArray(input) || input === null) ? input : [input]) as Keys<T>[] | null;

		if (paths === null) {
			const index = subscribers[nullSubscriberSymbol]!.indexOf(callback as any);
			delete subscribers[nullSubscriberSymbol]![index];
		} else {
			for (const key of paths) {
				if (!subscribers[key]) continue;
				
				const index = subscribers[key]!.indexOf(callback as any);
				delete subscribers[key]![index];
			}
		}
	};

	const subscribe: Observable<T>["subscribe"] = (input, callback, initialOptions = {}) => {
		const options = objects.create({ ...ObservableSubscribeOptionsDefaults, ...initialOptions });
		const paths = ((Array.isArray(input) || input === null) ? input : [input]) as Keys<T>[] | null;

		const initialCallback = callback.bind({});
		if (options.once) callback = (...args) => {
			unsubscribe(paths as any, callback);
			initialCallback(...args);
		};

		if (paths === null) {
			subscribers[nullSubscriberSymbol] ??= [];
			subscribers[nullSubscriberSymbol]!.push(callback as any);
		} else {
			for (const key of paths) {
				subscribers[key] ??= [];
				subscribers[key]!.push(callback as any);
			}
		}

		if (options.immediate) {
			for (const path of paths === null 
				? objects.keys(values) 
				: paths
			) {
				callback(objects.create<any>({ 
					path: path, 
					value: values[path],
					previousValue: values[path]
				}));
				
			}
		}

		return { 
			unsubscribe: () => unsubscribe(paths as any, callback)
		};
	};

	const compute: Observable<T>["compute"] = (declarationMap) => {
		for (const path of objects.keys(declarationMap)) {
			if (computes[path]) {
				// there was an existing compute for this path.
				// clean up all traces of the previous one and replace it.
				throw Error("Not implemented (compute key already exists)");
			}

			computes[path] = declarationMap[path];
			subscribe(declarationMap[path]!.dependencies, () => {
				store[path] = declarationMap[path]!.execute({ value: store }) as any;
			}, { immediate: true });
		}
	};

	if (objects.keys(computeDeclaration).length >= 1)
		compute(computeDeclaration);

	return Object.freeze(Object.assign<any, Observable<T>>(Object.create(null), {
		current: store,
		[valueSymbol]: values as T,
		[subscribersSymbol]: subscribers,
		[computesSymbol]: computes,
		subscribe,
		unsubscribe,
		compute
	}));
};