%% goal: answer(X0, X1)

answer(float_eq_int, X) :- 1.0 =:= 1.
answer(float_neq_int, fail) :- 1.0 =:= 2.
