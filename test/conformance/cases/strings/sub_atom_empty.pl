%% goal: answer(X)

answer(empty_substring, X) :- sub_atom("abc", 2, 0, _, X).
