%% goal: answer(X0, X1)

answer(empty_substring, X) :- sub_atom('abc', 2, 0, _, X).
