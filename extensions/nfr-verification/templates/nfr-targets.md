# Non-Functional Requirement Targets

Define quality attribute targets, verification strategies, and applicability across the 11 ISO/IEC 25010 areas.

## Non-functional targets

| ID     | Area                            | Applies | Target or Decision                                        | Verification  | Check or Tool               | Required | Reason (if not applicable) |
| ------ | ------------------------------- | ------- | --------------------------------------------------------- | ------------- | --------------------------- | -------- | -------------------------- |
| NFR-01 | security                        | yes     | State security target or decision                         | deterministic | Tool or check name          | yes      | -                          |
| NFR-02 | privacy and compliance          | no      | -                                                         | manual        | review                      | no       | Reason for not applicable  |
| NFR-03 | performance and capacity        | yes     | State latency, throughput, or capacity target             | deterministic | Benchmark or tool name      | yes      | -                          |
| NFR-04 | reliability                     | yes     | State availability, error rate, or fault tolerance target | deterministic | Test or tool name           | yes      | -                          |
| NFR-05 | observability                   | yes     | State logs, metrics, or traces target                     | deterministic | Metric or tool name         | yes      | -                          |
| NFR-06 | operability                     | yes     | State configuration, deployment, or recovery target       | deterministic | Check or tool name          | yes      | -                          |
| NFR-07 | compatibility and versioning    | yes     | State API, schema, or backward compatibility target       | deterministic | Contract check or tool name | yes      | -                          |
| NFR-08 | cost                            | no      | -                                                         | manual        | review                      | no       | Reason for not applicable  |
| NFR-09 | usability and accessibility     | yes     | State user experience or accessibility target             | manual        | Audit or tool name          | no       | -                          |
| NFR-10 | maintainability and testability | yes     | State modularity, test coverage, or linting target        | deterministic | Linter or test runner name  | yes      | -                          |
| NFR-11 | portability and environment     | yes     | State OS, runtime, or browser compatibility target        | deterministic | CI matrix or tool name      | yes      | -                          |
