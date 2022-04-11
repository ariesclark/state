import { objects } from "@ariesclark/utils";
import { throttle } from "@ariesclark/utils/dist/functions";
import { Flatten, Keys } from "@ariesclark/utils/dist/objects";

export interface SubscribeOptions {
	/**
	 * Remove the subscriber when called.
	 */
	once?: boolean,
	/**
	 * Immediately invoke the subscriber with the current values.
	 */
	immediate?: boolean
}

type Subscribers <T> = {
	[K in Keys<Current<T>> | typeof NullSubscriberKey]?:
		Array<SubscribeCallback<T>>
};

export interface SubscribeCallbackContext <T> {
	state: State<T>
}

export type SubscribeCallback <T> = (context: SubscribeCallbackContext<T>) => Promise<void> | void;

export interface SubscribeReturn {
	unsubscribe: () => void
}

/**
 * @param context {@link ComputeCallbackContext}
 */
export type ComputeCallback <T, K extends Keys<T>> = (context: SubscribeCallbackContext<T>) => T[K];

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

const NullSubscriberKey = Symbol("Null Subscriber");

export const SubscribeOptionsDefaults = Object.freeze<Required<SubscribeOptions>>({
	once: false,
	immediate: false
});

type Current <T> = Flatten<T>;

export class State <T> {

	/**
	 * The initial state.
	 */
	public initialState: Readonly<T>;

	/**
	 * @internal
	 */
	private current: Current<T>;

	/**
	 * @internal
	 */
	private subscribers: Subscribers<T> = objects.create();

	/**
	 * @internal
	 */
	private dirtyKeys: Set<Keys<Current<T>>> = new Set();

	/**
	 * @internal
	 */
	private _dispatch: (() => void) | null = null;

	/**
	 * Create a new maintained state.
	 * @param initialState The initial state.
	 */
	public constructor (
		initialState: Readonly<T>,
		private computeMap: ComputeMapDeclaration<T> = {}
	) {
		this.initialState = Object.freeze(objects.create(initialState));
		this.current = objects.flatten(objects.create(initialState));

		for (const key of objects.keys(computeMap)) {
			if (!computeMap[key]?.dependencies.length) throw new Error("Compute cannot have zero dependencies");

			this.subscribe(computeMap[key]?.dependencies || [], () => {
				const value = computeMap[key]?.execute({ state: this });
				if (value) this.set(key as any, value as any);
			}, { immediate: true });
		}
	}

	/**
	 * Get the current state object.
	 */
	public get (): Current<T>;

	/**
	 * Get the state value for the respective key.
	 * @param key An object key.
	 */
	public get <K extends Keys<Current<T>>> (key: K): Current<T>[K];

	public get (
		...args: [
			key: Keys<Current<T>>
		] | []
	): Current<T> | Current<T>[Keys<Current<T>>] {
		if (args.length === 1) return this.current[args[0]];
		return this.current;
	}

	/**
	 * Update the current state, this merges the value into the current state.
	 * @param value A partial state object.
	 */
	public set (value: Partial<Current<T>>): void;

	/**
	 * Update a specific key.
	 * @param key An object key.
	 * @param value The new value.
	 */
	public set <K extends Keys<Current<T>>> (key: K, value: Current<T>[K]): void

	public set (
		...args: [
			key: Keys<Current<T>>,
			value: Current<T>[Keys<Current<T>>]
		] | [value: Partial<Current<T>>]
	): void {
		if (args.length === 2) {
			const [key, value] = args;

			this.current[key] = value;
			this.dispatch(key);
			return;
		}

		throw new Error("Not implemented");
		/* for (const [key, value] of objects.entries(args[0])) {
			this.current[key] = value;
			this.dispatch(key);
		} */
	}

	private dispatch <K extends Keys<Current<T>>> (key: K): void {
		this.dirtyKeys.add(key);

		(this._dispatch ??= throttle(() => {
			console.debug("dispatch throttle");

			const callbacks: Array<SubscribeCallback<T>> = [...this.subscribers[NullSubscriberKey] || []];
			const keys = this.dirtyKeys.values();

			Array.from(keys).forEach((dirtyKey) => {
				callbacks.push(...(this.subscribers[dirtyKey] || []) as Array<SubscribeCallback<T>>);
				this.dirtyKeys.delete(dirtyKey);
			});

			const context = objects.create({ state: this });
			callbacks.forEach((callback) => callback(context));
		}, 1))();
	}

	/**
	 * Subscribe to state changes.
	 * @param input A specific key, an array of keys or `null` for every key.
	 * @param callback A function to listen to the changes.
	 * @param initialOptions see {@link SubscribeOptions}
	 */
	public subscribe <K extends Keys<Current<T>>> (
		input: (K | Array<K> | null),
		callback: SubscribeCallback<T>,
		initialOptions?: SubscribeOptions
	): SubscribeReturn {
		const options = objects.create({ ...SubscribeOptionsDefaults, ...initialOptions });
		const keys: Array<Keys<Current<T>>> | null = ((Array.isArray(input) || input === null) ? input : [input]);

		const initialCallback = callback.bind({});
		if (options.once) callback = (...args) => {
			this.unsubscribe(keys, callback);
			void initialCallback(...args);
		};

		if (keys === null) {
			this.subscribers[NullSubscriberKey] ??= [];
			this.subscribers[NullSubscriberKey]?.push(callback);
		} else {
			for (const key of keys) {
				this.subscribers[key] ??= [];
				this.subscribers[key]?.push(callback);
			}
		}

		if (options.immediate) keys?.forEach((key) => this.dispatch(key));

		return objects.create({
			unsubscribe: () => this.unsubscribe(keys, callback)
		});
	}

	/**
	 * Remove an existing subscriber, this will prevent it from receiving new changes.
	 * @param input A specific key, an array of keys or `null` for every key.
	 * @param callback The subscriber function to remove.
	 */
	public unsubscribe <K extends Keys<Current<T>>> (
		input: (K | Array<K> | null),
		callback: SubscribeCallback<T>
	): void {
		const keys: Array<Keys<Current<T>>> | null = ((Array.isArray(input) || input === null) ? input : [input]);

		if (keys === null) {
			const index = this.subscribers[NullSubscriberKey]?.indexOf(callback);
			if (index) delete this.subscribers[NullSubscriberKey]?.[index];
		} else {
			for (const key of keys) {
				if (!this.subscribers[key]) continue;

				const index = this.subscribers[key]?.indexOf(callback);
				if (index) delete this.subscribers[key]?.[index];
			}
		}
	}
}