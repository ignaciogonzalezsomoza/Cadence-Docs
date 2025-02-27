---
layout: default
title: Activities
permalink: /docs/concepts/activities
---

# Activities

Fault-oblivious stateful :workflow: code is the core abstraction of Cadence. But, due to deterministic execution requirements, they are not allowed to call any external API directly.
Instead they orchestrate execution of :activity:activities:. In its simplest form, a Cadence :activity: is a function or an object method in one of the supported languages.
Cadence does not recover :activity: state in case of failures. Therefore an :activity: function is allowed to contain any code without restrictions.

:activity:Activities: are invoked asynchronously through :task_list:task_lists:. A :task_list: is essentially a queue used to store an :activity_task: until it is picked up by an available :worker:. The :worker: processes an :activity: by invoking its implementation function. When the function returns, the :worker: reports the result back to the Cadence service which in turn notifies the :workflow: about completion. It is possible to implement an :activity: fully asynchronously by completing it from a different process.

## Timeouts

Cadence does not impose any system limit on :activity: duration. It is up to the application to choose the timeouts for its execution. These are the configurable :activity: timeouts:

- `ScheduleToStart` is the maximum time from a :workflow: requesting :activity: execution to a :worker: starting its execution. The usual reason for this timeout to fire is all :worker:workers: being down or not being able to keep up with the request rate. We recommend setting this timeout to the maximum time a :workflow: is willing to wait for an :activity: execution in the presence of all possible :worker: outages.
- `StartToClose` is the maximum time an :activity: can execute after it was picked by a :worker:.
- `ScheduleToClose` is the maximum time from the :workflow: requesting an :activity: execution to its completion.
- `Heartbeat` is the maximum time between heartbeat requests. See [Long Running Activities](#long-running-activities).

Either `ScheduleToClose` or both `ScheduleToStart` and `StartToClose` timeouts are required.

Timeouts are the key to manage activities. For more tips of how to set proper timeout, read this [Stack Overflow QA](https://stackoverflow.com/questions/65139178/how-to-set-proper-timeout-values-for-cadence-activitieslocal-and-regular-activi/65139179#65139179).

## Retries

As Cadence doesn't recover an :activity:'s state and they can communicate to any external system, failures are expected. Therefore, Cadence supports automatic :activity: retries. Any :activity: when invoked can have an associated retry policy. Here are the retry policy parameters:

- `InitialInterval` is a delay before the first retry.
- `BackoffCoefficient`. Retry policies are exponential. The coefficient specifies how fast the retry interval is growing. The coefficient of 1 means that the retry interval is always equal to the `InitialInterval`.
- `MaximumInterval` specifies the maximum interval between retries. Useful for coefficients more than 1.
- `MaximumAttempts` specifies how many times to attempt to execute an :activity: in the presence of failures. If this limit is exceeded, the error is returned back to the :workflow: that invoked the :activity:. Not required if `ExpirationInterval` is specified.
- `ExpirationInterval` specifies for how long to attempt executing an :activity: in the presence of failures. If this interval is exceeded, the error is returned back to the :workflow: that invoked the :activity:. Not required if `MaximumAttempts` is specified.
- `NonRetryableErrorReasons` allows you to specify errors that shouldn't be retried. For example retrying invalid arguments error doesn't make sense in some scenarios.

There are scenarios when not a single :activity: but rather the whole part of a :workflow: should be retried on failure. For example, a media encoding :workflow: that downloads a file to a host, processes it, and then uploads the result back to storage. In this :workflow:, if the host that hosts the :worker: dies, all three :activity:activities: should be retried on a different host. Such retries should be handled by the :workflow: code as they are very use case specific.

## Long Running Activities

For long running :activity:activities:, we recommended that you specify a relatively short heartbeat timeout and constantly heartbeat. This way :worker: failures for even very long running :activity:activities: can be handled in a timely manner. An :activity: that specifies the heartbeat timeout is expected to call the heartbeat method _periodically_ from its implementation.

A heartbeat request can include application specific payload. This is useful to save :activity: execution progress. If an :activity: times out due to a missed heartbeat, the next attempt to execute it can access that progress and continue its execution from that point.

Long running :activity:activities: can be used as a special case of leader election. Cadence timeouts use second resolution. So it is not a solution for realtime applications. But if it is okay to react to the process failure within a few seconds, then a Cadence heartbeat :activity: is a good fit.

One common use case for such leader election is monitoring. An :activity: executes an internal loop that periodically polls some API and checks for some condition. It also heartbeats on every iteration. If the condition is satisfied, the :activity: completes which lets its :workflow: to handle it. If the :activity_worker: dies, the :activity: times out after the heartbeat interval is exceeded and is retried on a different :worker:. The same pattern works for polling for new files in Amazon S3 buckets or responses in REST or other synchronous APIs.

## Cancellation

A :workflow: can request an :activity: cancellation. Currently the only way for an :activity: to learn that it was cancelled is through heart beating. The heartbeat request fails with a special error indicating that the :activity: was cancelled. Then it is up to the :activity: implementation to perform all the necessary cleanup and report that it is done with it. It is up to the :workflow: implementation to decide if it wants to wait for the :activity: cancellation confirmation or just proceed without waiting.

Another common case for :activity: heartbeat failure is that the :workflow: that invoked it is in a completed state. In this case an :activity: is expected to perform cleanup as well.

## Activity Task Routing through Task Lists

:activity:Activities: are dispatched to :worker:workers: through :task_list:task_lists:. :task_list:Task_lists: are queues that :worker:workers: listen on. :task_list:Task_lists: are highly dynamic and lightweight. They don't need to be explicitly registered. And it is okay to have one :task_list: per :worker: process. It is normal to have more than one :activity: type to be invoked through a single :task_list:. And it is normal in some cases (like host routing) to invoke the same :activity: type on multiple :task_list:task_lists:.

Here are some use cases for employing multiple :activity_task_list:activity_task_lists: in a single workflow:

- _Flow control_. A :worker: that consumes from a :task_list: asks for an :activity_task: only when it has available capacity. So :worker:workers: are never overloaded by request spikes. If :activity: executions are requested faster than :worker:workers: can process them, they are backlogged in the :task_list:.
- _Throttling_. Each :activity_worker: can specify the maximum rate it is allowed to processes :activity:activities: on a :task_list:. It does not exceed this limit even if it has spare capacity. There is also support for global :task_list: rate limiting. This limit works across all :worker:workers: for the given :task_list:. It is frequently used to limit load on a downstream service that an :activity: calls into.
- _Deploying a set of :activity:activities: independently_. Think about a service that hosts :activity:activities: and can be deployed independently from other :activity:activities: and :workflow:workflows:. To send :activity_task:activity_tasks: to this service, a separate :task_list: is needed.
- _:worker:Workers: with different capabilities_. For example, :worker:workers: on GPU boxes vs non GPU boxes. Having two separate :task_list:task_lists: in this case allows :workflow:workflows: to pick which one to send :activity: an execution request to.
- _Routing :activity: to a specific host_. For example, in the media encoding case the transform and upload :activity: have to run on the same host as the download one.
- _Routing :activity: to a specific process_. For example, some :activity:activities: load large data sets and caches it in the process. The :activity:activities: that rely on this data set should be routed to the same process.
- _Multiple priorities_. One :task_list: per priority and having a :worker: pool per priority.
- _Versioning_. A new backwards incompatible implementation of an :activity: might use a different :task_list:.

## Asynchronous Activity Completion

By default an :activity: is a function or a method depending on a client side library language. As soon as the function returns, an :activity: completes. But in some cases an :activity: implementation is asynchronous. For example it is forwarded to an external system through a message queue. And the reply comes through a different queue.

To support such use cases, Cadence allows :activity: implementations that do not complete upon :activity: function completions. A separate API should be used in this case to complete the :activity:. This API can be called from any process, even in a different programming language, that the original :activity_worker: used.

## Local Activities

Some of the :activity:activities: are very short lived and do not need the queing semantic, flow control, rate limiting and routing capabilities. For these Cadence supports so called _:local_activity:_ feature. :local_activity:Local_activities: are executed in the same :worker: process as the :workflow: that invoked them. Consider using :local_activity:local_activities: for functions that are:

* no longer than a few seconds
* do not require global rate limiting
* do not require routing to specific :worker:workers: or pools of :worker:workers:
* can be implemented in the same binary as the :workflow: that invokes them

The main benefit of :local_activity:local_activities: is that they are much more efficient in utilizing Cadence service resources and have much lower latency overhead comparing to the usual :activity: invocation.
